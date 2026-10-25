'use strict'

/**
 * @tom2012/dsh-file-tree — Host half
 *
 * 为右侧侧边栏「文件」标签页（接管原生 files kind 的 extension）提供宿主能力：
 *
 *  - 每个请求带 sessionId；用 ctx.sessions.get(sessionId).header.cwd 解析该会话的
 *    工作区，所有文件操作以该工作区为根（realpath + 逐段校验，拒绝 .. 穿越与软链逃逸）；
 *  - 同源路由 /-/filetree/*（status / list / text / write / create / rename / delete /
 *    download / zip / upload），复用 dsh-access-gate 的密码门与 connection 信任栅栏，
 *    不新开端口、不引入独立服务器；
 *  - 下载与 ZIP 全部流式处理，不把整个目录读进内存；
 *  - 删除默认进回收目录（可配），根目录本身拒删。
 */

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const zlib = require('node:zlib')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const API_PREFIX = '/-/filetree'

const DEFAULTS = {
  maxTextBytes: 2 * 1024 * 1024,
  maxWriteBytes: 5 * 1024 * 1024,
  maxUploadBytes: 4 * 1024 * 1024 * 1024,
  zipInlineLimit: 16 * 1024 * 1024,
  trashDir: path.join(os.homedir(), '.dsh-file-tree-trash'),
}

/* ------------------------------------------------------------------ *
 * CRC32（Node >= 20.12 用内置，否则退化为查表实现）
 * ------------------------------------------------------------------ */

const crc32 = (() => {
  if (typeof zlib.crc32 === 'function') {
    return (buf, prev) => zlib.crc32(buf, prev >>> 0) >>> 0
  }
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return (buf, prev) => {
    let c = (prev >>> 0) ^ 0xffffffff
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff]
    return (c ^ 0xffffffff) >>> 0
  }
})()

/* ------------------------------------------------------------------ *
 * 路径安全
 * ------------------------------------------------------------------ */

/** 把 p 解析为真实目录；失败或不是目录返回 null。 */
function realDir(p) {
  try {
    const resolved = fs.realpathSync(p)
    return fs.statSync(resolved).isDirectory() ? resolved : null
  } catch {
    return null
  }
}

/** target 是否等于 root 或位于 root 之内。 */
function insideRoot(root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * 解析 root 内的一个相对路径并做逃逸校验。
 *
 * 逐段向上找第一个真实存在的祖先做 realpath，再把剩余不存在的尾段接回去，
 * 因此对「还不存在的新文件」也能正确校验，同时拦住符号链接逃逸。
 *
 * @throws {Error} status 403 越界 / 400 不可解析
 */
function realInside(root, rel) {
  const abs = path.resolve(root, rel === undefined || rel === null ? '.' : String(rel))
  let probe = abs
  const tail = []
  for (;;) {
    let realpath
    try {
      realpath = fs.realpathSync(probe)
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        const e = new Error(`路径不可访问: ${(err && err.message) || err}`)
        e.status = 400
        throw e
      }
      const parent = path.dirname(probe)
      if (parent === probe) {
        const e = new Error('无法解析路径')
        e.status = 400
        throw e
      }
      tail.unshift(path.basename(probe))
      probe = parent
      continue
    }
    const full = tail.length ? path.join(realpath, ...tail) : realpath
    if (!insideRoot(root, full)) {
      const e = new Error('路径越出会话工作区，已拒绝')
      e.status = 403
      throw e
    }
    return full
  }
}

/** 只接受单段文件名（不允许分隔符、"."、".."）。 */
function isSingleSegment(name) {
  if (typeof name !== 'string') return false
  const t = name.trim()
  if (!t || t === '.' || t === '..') return false
  if (t.includes('/') || t.includes('\\') || t.includes('\0')) return false
  return true
}

/** 校验并规范化上传用的相对路径（允许 a/b/c 形式，但每段必须是单段名）。 */
function safeRelative(rel) {
  const segs = String(rel).split(/[/\\]+/).filter((s) => s !== '' && s !== '.')
  for (const s of segs) {
    if (s === '..' || s.includes('\0')) return null
  }
  return segs.length ? segs.join('/') : null
}

/* ------------------------------------------------------------------ *
 * HTTP 工具
 * ------------------------------------------------------------------ */

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readJsonBody(req, limit = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

/** RFC 5987 编码的附件名，兼容中文。 */
function contentDisposition(filename) {
  const ascii = String(filename).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

/* ------------------------------------------------------------------ *
 * ZIP（store 方式，流式；本地头带真实 CRC，双遍读取换最大兼容性）
 * ------------------------------------------------------------------ */

function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date()
  const time =
    ((d.getHours() & 0x1f) << 11) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((Math.floor(d.getSeconds() / 2)) & 0x1f)
  const day =
    (((d.getFullYear() - 1980) & 0x7f) << 9) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (d.getDate() & 0x1f)
  return { time, date: day }
}

function localHeader(nameBuf, crc, size, dt) {
  const h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0)
  h.writeUInt16LE(20, 4) // version needed
  h.writeUInt16LE(0x0800, 6) // 仅 UTF-8 标志位
  h.writeUInt16LE(0, 8) // method: store
  h.writeUInt16LE(dt.time, 10)
  h.writeUInt16LE(dt.date, 12)
  h.writeUInt32LE(crc >>> 0, 14)
  h.writeUInt32LE(size >>> 0, 18)
  h.writeUInt32LE(size >>> 0, 22)
  h.writeUInt16LE(nameBuf.length, 26)
  h.writeUInt16LE(0, 28)
  return Buffer.concat([h, nameBuf])
}

function centralHeader(nameBuf, crc, size, dt, offset, isDir) {
  const h = Buffer.alloc(46)
  const mode = isDir ? 0o040755 : 0o100644
  h.writeUInt32LE(0x02014b50, 0)
  h.writeUInt16LE(0x031e, 4) // made by: unix, 3.0
  h.writeUInt16LE(20, 6)
  h.writeUInt16LE(0x0800, 8)
  h.writeUInt16LE(0, 10)
  h.writeUInt16LE(dt.time, 12)
  h.writeUInt16LE(dt.date, 14)
  h.writeUInt32LE(crc >>> 0, 16)
  h.writeUInt32LE(size >>> 0, 20)
  h.writeUInt32LE(size >>> 0, 24)
  h.writeUInt16LE(nameBuf.length, 28)
  h.writeUInt16LE(0, 30)
  h.writeUInt16LE(0, 32)
  h.writeUInt16LE(0, 34)
  h.writeUInt16LE(0, 36)
  h.writeUInt32LE((((mode << 16) >>> 0) | (isDir ? 0x10 : 0)) >>> 0, 38)
  h.writeUInt32LE(offset >>> 0, 42)
  return Buffer.concat([h, nameBuf])
}

function endOfCentralDirectory(count, cdSize, cdOffset) {
  const h = Buffer.alloc(22)
  h.writeUInt32LE(0x06054b50, 0)
  h.writeUInt16LE(0, 4)
  h.writeUInt16LE(0, 6)
  h.writeUInt16LE(Math.min(count, 0xffff), 8)
  h.writeUInt16LE(Math.min(count, 0xffff), 10)
  h.writeUInt32LE(cdSize >>> 0, 12)
  h.writeUInt32LE(cdOffset >>> 0, 16)
  h.writeUInt16LE(0, 20)
  return h
}

/** 流式算一个文件的 CRC32（不整块读入内存）。 */
async function crcOfFile(abs) {
  let crc = 0
  const stream = fs.createReadStream(abs, { highWaterMark: 1 << 20 })
  for await (const chunk of stream) crc = crc32(chunk, crc)
  return crc >>> 0
}

/**
 * 遍历收集要打包的条目。
 *
 * 不跟随符号链接目录（避免环），符号链接文件按真实目标校验仍在根内才收录。
 * @returns {{abs:string,zipName:string,isDir:boolean,size:number,mtime:Date}[]}
 */
function collectZipEntries(root, abs, zipName, out, depth = 0) {
  if (depth > 64) return out
  let st
  try {
    st = fs.lstatSync(abs)
  } catch {
    return out
  }

  if (st.isSymbolicLink()) {
    let target
    try {
      target = fs.realpathSync(abs)
    } catch {
      return out
    }
    if (!insideRoot(root, target)) return out
    let tst
    try {
      tst = fs.statSync(target)
    } catch {
      return out
    }
    if (tst.isDirectory()) return out // 不递归软链目录
    out.push({ abs: target, zipName, isDir: false, size: tst.size, mtime: tst.mtime })
    return out
  }

  if (st.isDirectory()) {
    out.push({ abs, zipName: `${zipName}/`, isDir: true, size: 0, mtime: st.mtime })
    let names
    try {
      names = fs.readdirSync(abs)
    } catch {
      return out
    }
    names.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
    for (const name of names) {
      collectZipEntries(root, path.join(abs, name), `${zipName}/${name}`, out, depth + 1)
    }
    return out
  }

  if (st.isFile()) {
    out.push({ abs, zipName, isDir: false, size: st.size, mtime: st.mtime })
  }
  return out
}

/** 把收集到的条目流式产出为 ZIP 分块。 */
async function* zipChunks(entries, inlineLimit) {
  const central = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.zipName, 'utf8')
    const dt = dosDateTime(entry.mtime)

    if (entry.isDir) {
      const header = localHeader(nameBuf, 0, 0, dt)
      yield header
      central.push(centralHeader(nameBuf, 0, 0, dt, offset, true))
      offset += header.length
      continue
    }

    if (entry.size <= inlineLimit) {
      const buf = await fsp.readFile(entry.abs)
      const crc = crc32(buf, 0)
      const header = localHeader(nameBuf, crc, buf.length, dt)
      yield header
      yield buf
      central.push(centralHeader(nameBuf, crc, buf.length, dt, offset, false))
      offset += header.length + buf.length
      continue
    }

    // 大文件：先流式算 CRC（本地头带真实 CRC，换取最大解包兼容性），再流式输出内容。
    const crc = await crcOfFile(entry.abs)
    const header = localHeader(nameBuf, crc, entry.size, dt)
    yield header
    let written = 0
    const stream = fs.createReadStream(entry.abs, { highWaterMark: 1 << 20 })
    for await (const chunk of stream) {
      yield chunk
      written += chunk.length
    }
    central.push(centralHeader(nameBuf, crc, written, dt, offset, false))
    offset += header.length + written
  }

  const cdOffset = offset
  let cdSize = 0
  for (const rec of central) {
    yield rec
    cdSize += rec.length
  }
  yield endOfCentralDirectory(central.length, cdSize, cdOffset)
}

/**
 * 把收集到的条目流式写成一个 ZIP 响应。
 *
 * async generator + Readable.from + pipeline：背压、错误与连接中断全部交给 Node 的
 * 流机制处理，不必手工做 write/drain 记账（手工做会每次写都挂一个 error 监听器）。
 */
async function streamZip(res, entries, inlineLimit) {
  await pipeline(Readable.from(zipChunks(entries, inlineLimit)), res)
}

/* ------------------------------------------------------------------ *
 * 插件
 * ------------------------------------------------------------------ */

const inject = ['webServer', 'sessions', 'connection']

function apply(ctx, config) {
  const opts = Object.assign({}, DEFAULTS, config || {})
  const logger = ctx.logger ? ctx.logger('dsh-file-tree') : null
  const warn = (msg) => (logger && logger.warn ? logger.warn(msg) : console.warn(`[dsh-file-tree] ${msg}`))
  const sessions = ctx.sessions
  const webServer = ctx.webServer

  /** 解析请求的会话工作区。 */
  function workspaceOf(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      return { ok: false, status: 400, error: '缺少 sessionId' }
    }
    let session = null
    try {
      session = sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : null
    } catch (err) {
      return { ok: false, status: 404, error: `会话读取失败: ${(err && err.message) || err}` }
    }
    if (!session) {
      return { ok: false, status: 404, error: '该会话不在本实例的活跃会话中（请先在本实例打开该会话）' }
    }
    const cwd = session.header && session.header.cwd
    if (typeof cwd !== 'string' || !cwd) {
      return { ok: false, status: 404, error: '该会话没有可用的工作区(cwd)' }
    }
    const root = realDir(cwd)
    if (!root) {
      return { ok: false, status: 404, error: `工作区目录不存在或不可访问: ${cwd}` }
    }
    return { ok: true, workspace: cwd, root }
  }

  /** 列出单层目录。 */
  async function handleList(root, rel) {
    const abs = realInside(root, rel)
    let st
    try {
      st = fs.statSync(abs)
    } catch {
      const e = new Error('目录不存在')
      e.status = 404
      throw e
    }
    if (!st.isDirectory()) {
      const e = new Error('不是目录')
      e.status = 400
      throw e
    }
    const dirents = await fsp.readdir(abs, { withFileTypes: true })
    const entries = []
    for (const d of dirents) {
      const childAbs = path.join(abs, d.name)
      let type = 'file'
      if (d.isDirectory()) type = 'dir'
      else if (d.isSymbolicLink()) type = 'symlink'
      let size = 0
      let mtimeMs = 0
      try {
        const cst = fs.statSync(childAbs)
        size = cst.size
        mtimeMs = cst.mtimeMs
        if (type === 'symlink') type = cst.isDirectory() ? 'dir' : 'file'
      } catch {
        /* 断链：保留原名，size 0 */
      }
      entries.push({ name: d.name, type, size, mtimeMs })
    }
    entries.sort((a, b) => {
      if (a.type === 'dir' && b.type !== 'dir') return -1
      if (a.type !== 'dir' && b.type === 'dir') return 1
      return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })
    })
    return { entries }
  }

  /** 单个文件下载，支持 Range。 */
  async function handleDownload(req, res, root, rel) {
    const abs = realInside(root, rel)
    let st
    try {
      st = fs.statSync(abs)
    } catch {
      return sendJson(res, 404, { ok: false, error: '文件不存在' })
    }
    if (!st.isFile()) return sendJson(res, 400, { ok: false, error: '不是普通文件' })

    const name = path.basename(abs)
    const base = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': contentDisposition(name),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    }

    const range = req.headers.range
    let start = 0
    let end = st.size - 1
    if (typeof range === 'string') {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (m) {
        if (m[1] === '' && m[2] !== '') {
          const suffix = Number(m[2])
          start = Math.max(0, st.size - suffix)
        } else if (m[1] !== '') {
          start = Number(m[1])
          if (m[2] !== '') end = Math.min(Number(m[2]), st.size - 1)
        }
        if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= st.size) {
          res.writeHead(416, { 'Content-Range': `bytes */${st.size}` })
          return res.end()
        }
        res.writeHead(206, {
          ...base,
          'Content-Range': `bytes ${start}-${end}/${st.size}`,
          'Content-Length': String(end - start + 1),
        })
        return pipeline(fs.createReadStream(abs, { start, end }), res).catch(() => {})
      }
    }

    res.writeHead(200, { ...base, 'Content-Length': String(st.size) })
    if (req.method === 'HEAD') return res.end()
    return pipeline(fs.createReadStream(abs), res).catch(() => {})
  }

  /** 收一个上传文件：原始字节流 → 临时 .part → 原子 rename。 */
  async function handleUpload(req, res, root, dirRel) {
    const rawName = req.headers['x-file-rel'] || req.headers['x-file-name']
    if (typeof rawName !== 'string' || !rawName) {
      return sendJson(res, 400, { ok: false, error: '缺少 x-file-name / x-file-rel 头' })
    }
    let decoded
    try {
      decoded = decodeURIComponent(rawName)
    } catch {
      return sendJson(res, 400, { ok: false, error: '文件名编码非法' })
    }

    const relPath = safeRelative(decoded)
    if (!relPath) return sendJson(res, 400, { ok: false, error: '文件名非法（只接受相对路径）' })

    const segments = relPath.split('/')
    const filename = segments.pop()
    if (!isSingleSegment(filename)) return sendJson(res, 400, { ok: false, error: '文件名非法' })

    const baseDir = realInside(root, dirRel)
    let destDir = baseDir
    for (const seg of segments) {
      destDir = realInside(root, path.relative(root, path.join(destDir, seg)))
      await fsp.mkdir(destDir, { recursive: true })
    }
    const dest = realInside(root, path.relative(root, path.join(destDir, filename)))

    let size = 0
    let aborted = false
    req.on('aborted', () => {
      aborted = true
    })

    const tmp = `${dest}.part-${process.pid}-${Date.now()}`
    try {
      const out = fs.createWriteStream(tmp)
      req.on('data', (c) => {
        size += c.length
        if (size > opts.maxUploadBytes) req.destroy(new Error('超过单文件上传上限'))
      })
      await pipeline(req, out)
      if (aborted) {
        await fsp.rm(tmp, { force: true })
        return
      }
      await fsp.rename(tmp, dest)
      return sendJson(res, 200, { ok: true, path: relPath, size })
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {})
      return sendJson(res, 500, { ok: false, error: String((err && err.message) || err) })
    }
  }

  /** 读文本（在线编辑用）。 */
  async function handleText(root, rel, maxBytes) {
    const abs = realInside(root, rel)
    const st = await fsp.stat(abs)
    if (!st.isFile()) {
      const e = new Error('不是普通文件')
      e.status = 400
      throw e
    }
    const truncated = st.size > maxBytes
    const fh = await fsp.open(abs, 'r')
    try {
      const len = Math.min(st.size, maxBytes)
      const buf = Buffer.alloc(len)
      await fh.read(buf, 0, len, 0)
      if (buf.includes(0)) {
        const e = new Error('二进制文件不支持在线编辑')
        e.status = 415
        throw e
      }
      return {
        text: buf.toString('utf8'),
        truncated,
        size: st.size,
        mtimeMs: st.mtimeMs,
      }
    } finally {
      await fh.close().catch(() => {})
    }
  }

  /** 原子保存 + mtime/size 冲突检测。 */
  async function handleWrite(root, payload, maxBytes) {
    const rel = payload && payload.path
    const text = payload && payload.text
    if (typeof rel !== 'string' || typeof text !== 'string') {
      const e = new Error('缺少 path / text')
      e.status = 400
      throw e
    }
    const bytes = Buffer.byteLength(text, 'utf8')
    if (bytes > maxBytes) {
      const e = new Error(`单次保存超过上限（${bytes} > ${maxBytes}）`)
      e.status = 413
      throw e
    }
    const abs = realInside(root, rel)
    let existing = null
    try {
      existing = await fsp.stat(abs)
    } catch {
      /* 新文件 */
    }

    const expected = payload.expected
    if (expected && existing) {
      const staleMtime = typeof expected.mtimeMs === 'number' && Math.abs(existing.mtimeMs - expected.mtimeMs) > 1
      const staleSize = typeof expected.size === 'number' && existing.size !== expected.size
      if (staleMtime || staleSize) {
        const e = new Error('文件已被外部修改，请重新加载后再保存')
        e.status = 409
        throw e
      }
    }

    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`
    try {
      await fsp.writeFile(tmp, text, 'utf8')
      await fsp.rename(tmp, abs)
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {})
      throw err
    }
    const after = await fsp.stat(abs)
    return { size: after.size, mtimeMs: after.mtimeMs }
  }

  /** 新建文件 / 文件夹。 */
  async function handleCreate(root, payload) {
    const dir = payload && payload.dir
    const name = payload && payload.name
    const kind = (payload && payload.kind) || 'file'
    if (!isSingleSegment(name)) {
      const e = new Error('名称非法（只接受单段名）')
      e.status = 400
      throw e
    }
    const dirAbs = realInside(root, dir)
    const abs = realInside(root, path.relative(root, path.join(dirAbs, String(name).trim())))
    if (fs.existsSync(abs)) {
      const e = new Error('同名文件或文件夹已存在')
      e.status = 409
      throw e
    }
    if (kind === 'dir') {
      await fsp.mkdir(abs, { recursive: true })
    } else {
      await fsp.writeFile(abs, typeof payload.text === 'string' ? payload.text : '', { flag: 'wx' })
    }
    return { path: path.relative(root, abs), kind }
  }

  /** 同目录改名。 */
  async function handleRename(root, payload) {
    const rel = payload && payload.path
    const name = payload && payload.name
    if (!isSingleSegment(name)) {
      const e = new Error('名称非法（只接受单段名）')
      e.status = 400
      throw e
    }
    const abs = realInside(root, rel)
    if (abs === root) {
      const e = new Error('不能重命名工作区根目录')
      e.status = 403
      throw e
    }
    const dest = realInside(root, path.relative(root, path.join(path.dirname(abs), String(name).trim())))
    if (dest !== abs && fs.existsSync(dest)) {
      const e = new Error('同名文件或文件夹已存在')
      e.status = 409
      throw e
    }
    await fsp.rename(abs, dest)
    return { path: path.relative(root, dest) }
  }

  /** 删除：默认进回收目录。 */
  async function handleDelete(root, payload, trashDir) {
    const paths = Array.isArray(payload && payload.paths) ? payload.paths : []
    const permanent = Boolean(payload && payload.permanent)
    if (!paths.length) {
      const e = new Error('没有要删除的项')
      e.status = 400
      throw e
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const removed = []
    for (const rel of paths) {
      const abs = realInside(root, rel)
      if (abs === root) {
        const e = new Error('不能删除工作区根目录')
        e.status = 403
        throw e
      }
      if (!fs.existsSync(abs)) continue
      if (permanent) {
        await fsp.rm(abs, { recursive: true, force: true })
      } else {
        const bucket = path.join(trashDir, stamp)
        await fsp.mkdir(bucket, { recursive: true })
        let target = path.join(bucket, path.basename(abs))
        let n = 2
        while (fs.existsSync(target)) target = path.join(bucket, `${path.basename(abs)} (${n++})`)
        try {
          await fsp.rename(abs, target)
        } catch {
          await fsp.rm(abs, { recursive: true, force: true })
        }
      }
      removed.push(rel)
    }
    return { removed }
  }

  if (!webServer || typeof webServer.register !== 'function') {
    warn('webServer 不可用，文件树 API 未注册')
    return
  }

  ctx.effect(() => {
    webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: async (req, res) => {
        // 与其它 host 路由一致的信任栅栏：connection 的 Host/Origin 检查 + 浏览器认证。
        const rejection = ctx.connection && ctx.connection.requestRejection ? ctx.connection.requestRejection(req) : undefined
        if (rejection !== undefined) {
          res.writeHead(rejection)
          res.end()
          return
        }

        try {
          const url = new URL(req.url || '/', 'http://dsh.local')
          const rest = url.pathname.startsWith(API_PREFIX) ? url.pathname.slice(API_PREFIX.length) : null
          if (rest === null) return sendJson(res, 404, { ok: false, error: 'not found' })

          const sessionId = url.searchParams.get('sessionId')
          const ws = workspaceOf(sessionId)
          if (!ws.ok) return sendJson(res, ws.status, { ok: false, error: ws.error })
          const root = ws.root

          // 状态探测：统一 200 语义化返回，客户端据此走不可用分支。
          if (req.method === 'GET' && (rest === '' || rest === '/' || rest === '/status')) {
            return sendJson(res, 200, { ok: true, sessionId, workspace: ws.workspace })
          }

          if (req.method === 'GET' && rest === '/list') {
            const result = await handleList(root, url.searchParams.get('path') || '')
            return sendJson(res, 200, { ok: true, ...result })
          }

          if (req.method === 'GET' && rest === '/text') {
            const result = await handleText(root, url.searchParams.get('path'), opts.maxTextBytes)
            return sendJson(res, 200, { ok: true, ...result })
          }

          if ((req.method === 'GET' || req.method === 'HEAD') && rest === '/download') {
            return await handleDownload(req, res, root, url.searchParams.get('path'))
          }

          if (req.method === 'GET' && rest === '/zip') {
            const targets = url.searchParams.getAll('path')
            if (!targets.length) return sendJson(res, 400, { ok: false, error: '缺少 path' })
            const entries = []
            for (const rel of targets) {
              const abs = realInside(root, rel)
              const base = path.basename(abs) || 'workspace'
              collectZipEntries(root, abs, base, entries)
            }
            if (!entries.length) return sendJson(res, 404, { ok: false, error: '没有可打包的内容' })
            // 当前写的是 ZIP32：静默截断 32 位大小/偏移会生成损坏压缩包，
            // 因此在发响应头之前明确拒绝，要求用户分批下载。
            const zipBytes = entries.reduce(
              (total, entry) =>
                total +
                30 +
                Buffer.byteLength(entry.zipName, 'utf8') +
                (entry.isDir ? 0 : entry.size) +
                46 +
                Buffer.byteLength(entry.zipName, 'utf8'),
              22,
            )
            if (entries.length >= 0xffff || zipBytes >= 0xffffffff) {
              return sendJson(res, 413, {
                ok: false,
                error: 'ZIP 超过 32 位格式上限（约 4 GiB 或 65534 项），请分批下载（暂不支持 ZIP64）',
              })
            }
            const zipName = targets.length === 1 ? `${path.basename(realInside(root, targets[0])) || 'workspace'}.zip` : 'selection.zip'
            res.writeHead(200, {
              'Content-Type': 'application/zip',
              'Content-Disposition': contentDisposition(zipName),
              'Cache-Control': 'no-store',
            })
            await streamZip(res, entries, opts.zipInlineLimit)
            res.end()
            return
          }

          if (req.method === 'POST' && rest === '/upload') {
            return await handleUpload(req, res, root, url.searchParams.get('path') || '')
          }

          if (req.method === 'POST') {
            // JSON 转义会让请求体大于纯文本字节数，给 write 留出转义空间；
            // 其他管理操作仍保持 1 MiB 上限。
            const bodyLimit = rest === '/write' ? Math.max(1 << 20, opts.maxWriteBytes * 7 + 65536) : 1 << 20
            const payload = await readJsonBody(req, bodyLimit)
            if (rest === '/write') {
              const result = await handleWrite(root, payload, opts.maxWriteBytes)
              return sendJson(res, 200, { ok: true, ...result })
            }
            if (rest === '/create') {
              const result = await handleCreate(root, payload)
              return sendJson(res, 200, { ok: true, ...result })
            }
            if (rest === '/rename') {
              const result = await handleRename(root, payload)
              return sendJson(res, 200, { ok: true, ...result })
            }
            if (rest === '/delete') {
              const result = await handleDelete(root, payload, opts.trashDir)
              return sendJson(res, 200, { ok: true, ...result })
            }
          }

          return sendJson(res, 404, { ok: false, error: `未知路由: ${rest}` })
        } catch (err) {
          const status = (err && err.status) || 500
          if (!res.headersSent) {
            sendJson(res, status, { ok: false, error: String((err && err.message) || err) })
          } else {
            try {
              res.end()
            } catch {
              /* 已断开的流 */
            }
          }
        }
      },
    })
  }, 'dsh-file-tree: workspace file api')

  // 不 return 任何值 —— cordis-plugin-loader 把 apply 的返回值当作 disposable/effect。
}

module.exports = { inject, apply }
