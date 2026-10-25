/**
 * 宿主半自测：不依赖 DSH，用假 ctx 捕获路由处理器，起真 HTTP 服务，
 * 在工作区里真建/真删/真打包，逐项断言。
 *
 * 运行：node scripts/selftest.mjs
 */
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const plugin = require('../src/index.js')

const SESSION = 'test-session'
const base = mkdtempSync(join(tmpdir(), 'ft-selftest-'))
const ROOT = join(base, 'workspace')
const TRASH = join(base, 'trash')
mkdirSync(join(ROOT, 'sub', 'deep'), { recursive: true })
mkdirSync(TRASH, { recursive: true })
writeFileSync(join(ROOT, 'hello.txt'), 'hello world\n')
writeFileSync(join(ROOT, 'sub', 'deep', '中文文件.txt'), '中文内容\n')
writeFileSync(join(ROOT, 'binary.bin'), Buffer.from([0, 1, 2, 3, 255, 254]))
writeFileSync(join(ROOT, 'big.txt'), 'x'.repeat(64 * 1024))

let captured = null
let rejectionCalls = 0
const ctx = {
  logger: () => ({ warn: (m) => console.log(`  [plugin warn] ${m}`) }),
  sessions: { get: (id) => (id === SESSION ? { header: { cwd: ROOT } } : undefined) },
  connection: {
    requestRejection: () => {
      rejectionCalls++
      return undefined
    },
  },
  webServer: {
    register: (spec) => {
      captured = spec
      return () => {}
    },
  },
  effect: (fn) => fn(),
}

plugin.apply(ctx, { trashDir: TRASH })

if (!captured || captured.kind !== 'prefix' || captured.path !== '/-/filetree') {
  console.error('✗ 路由未按预期注册:', captured)
  process.exit(1)
}

const server = createServer((req, res) => captured.handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`
const API = `${origin}/-/filetree`

let pass = 0
const failures = []
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const get = (route, params = {}, sid = SESSION) => {
  const u = new URL(`${API}${route}`)
  if (sid !== null) u.searchParams.set('sessionId', sid)
  for (const [k, v] of Object.entries(params)) u.searchParams.append(k, v)
  return fetch(u, { redirect: 'manual' })
}
const getJson = async (...args) => {
  const res = await get(...args)
  let body = null
  try {
    body = await res.json()
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, body }
}
const post = (route, payload, sid = SESSION) => {
  const u = new URL(`${API}${route}`)
  if (sid !== null) u.searchParams.set('sessionId', sid)
  return fetch(u, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}
const postJson = async (route, payload) => {
  const res = await post(route, payload)
  let body = null
  try {
    body = await res.json()
  } catch {
    /* 非 JSON */
  }
  return { status: res.status, body }
}

console.log('\n── 1. status / 会话解析 ──')
{
  const ok = await getJson('/status')
  check('status 返回工作区', ok.status === 200 && ok.body.ok && ok.body.workspace === ROOT, JSON.stringify(ok.body))
  const noSid = await getJson('/status', {}, null)
  check('缺 sessionId → 400', noSid.status === 400, `got ${noSid.status}`)
  const bad = await getJson('/status', {}, 'nope')
  check('未知会话 → 404', bad.status === 404, `got ${bad.status}`)
  check('信任栅栏被调用', rejectionCalls > 0, `calls=${rejectionCalls}`)
}

console.log('\n── 2. list（单层懒加载）──')
{
  const r = await getJson('/list', { path: '' })
  const names = (r.body.entries || []).map((e) => e.name)
  check('根目录列出全部条目', r.status === 200 && names.length === 4, names.join(','))
  check('目录排在文件前', r.body.entries[0].type === 'dir' && r.body.entries[0].name === 'sub', names.join(','))
  check('返回 size/mtime', typeof r.body.entries.find((e) => e.name === 'hello.txt').size === 'number')
  const deep = await getJson('/list', { path: 'sub/deep' })
  check('嵌套目录可列', deep.status === 200 && deep.body.entries[0].name === '中文文件.txt')
  const notDir = await getJson('/list', { path: 'hello.txt' })
  check('对文件 list → 400', notDir.status === 400, `got ${notDir.status}`)
}

console.log('\n── 3. 路径越界防护 ──')
{
  for (const evil of ['../../etc', '/etc', 'sub/../../..', '..', '../']) {
    const r = await getJson('/list', { path: evil })
    check(`拒绝越界 path=${JSON.stringify(evil)}`, r.status === 403 || r.status === 400, `got ${r.status}`)
  }
  const dl = await getJson('/text', { path: '../../../etc/passwd' })
  check('text 拒绝越界', dl.status === 403 || dl.status === 400, `got ${dl.status}`)
}

console.log('\n── 4. upload（单/多文件 + 目录结构 + 中文名）──')
{
  const one = await fetch(`${API}/upload?sessionId=${SESSION}&path=`, {
    method: 'POST',
    headers: { 'x-file-name': encodeURIComponent('上传的中文.txt') },
    body: Buffer.from('uploaded by test\n'),
  })
  const oneBody = await one.json()
  check('上传单个中文名文件', one.status === 200 && oneBody.ok, JSON.stringify(oneBody))
  check('内容落盘正确', readFileSync(join(ROOT, '上传的中文.txt'), 'utf8') === 'uploaded by test\n')

  const nested = await fetch(`${API}/upload?sessionId=${SESSION}&path=`, {
    method: 'POST',
    headers: { 'x-file-rel': encodeURIComponent('picked/nested/deep.txt') },
    body: Buffer.from('nested\n'),
  })
  check('按 x-file-rel 建中间目录', nested.status === 200 && existsSync(join(ROOT, 'picked/nested/deep.txt')))

  const evilName = await fetch(`${API}/upload?sessionId=${SESSION}&path=`, {
    method: 'POST',
    headers: { 'x-file-name': encodeURIComponent('../../escape.txt') },
    body: Buffer.from('nope'),
  })
  check('拒绝 ../ 文件名', evilName.status === 400, `got ${evilName.status}`)
  check('确认未写出根目录', !existsSync(join(base, 'escape.txt')))

  const toSub = await fetch(`${API}/upload?sessionId=${SESSION}&path=sub`, {
    method: 'POST',
    headers: { 'x-file-name': encodeURIComponent('into-sub.txt') },
    body: Buffer.from('sub\n'),
  })
  check('上传到指定子目录', toSub.status === 200 && existsSync(join(ROOT, 'sub/into-sub.txt')))

  const noLeak = existsSync(ROOT) && !readFileSync(join(ROOT, 'hello.txt'), 'utf8').includes('part-')
  check('无 .part 临时文件残留', noLeak && !readdirHasPart(ROOT))
}
function readdirHasPart(dir) {
  for (const name of require('node:fs').readdirSync(dir)) {
    if (name.includes('.part-') || name.includes('.tmp-')) return true
  }
  return false
}

console.log('\n── 5. download（完整 + Range + 中文名附件头）──')
{
  const res = await get('/download', { path: 'hello.txt' })
  const text = await res.text()
  check('完整下载', res.status === 200 && text === 'hello world\n', `status=${res.status}`)
  check('附件头含 UTF-8 文件名', /filename\*=UTF-8''hello\.txt/.test(res.headers.get('content-disposition') || ''))
  check('声明 Accept-Ranges', res.headers.get('accept-ranges') === 'bytes')

  const range = await get('/download', { path: 'big.txt' })
  // 用显式 Range 头再请求一次
  const u = new URL(`${API}/download`)
  u.searchParams.set('sessionId', SESSION)
  u.searchParams.set('path', 'big.txt')
  const part = await fetch(u, { headers: { Range: 'bytes=0-4' } })
  const partBody = await part.text()
  check('Range 请求 → 206', part.status === 206, `got ${part.status}`)
  check('Content-Range 正确', part.headers.get('content-range') === `bytes 0-4/${64 * 1024}`)
  check('分片内容长度 5', partBody.length === 5)

  const cn = await get('/download', { path: '上传的中文.txt' })
  const cd = cn.headers.get('content-disposition') || ''
  check('中文名附件头可解码', decodeURIComponent((cd.match(/filename\*=UTF-8''(.*)$/) || [])[1] || '') === '上传的中文.txt')
  await cn.text()

  const missing = await get('/download', { path: 'nope.txt' })
  check('下载不存在 → 404', missing.status === 404, `got ${missing.status}`)
}

console.log('\n── 6. zip（流式打包 + 外部校验）──')
{
  const res = await get('/zip', { path: 'sub' })
  const buf = Buffer.from(await res.arrayBuffer())
  check('zip 响应 200', res.status === 200, `status=${res.status}`)
  check('Content-Type: application/zip', res.headers.get('content-type') === 'application/zip')
  const zipPath = join(base, 'sub.zip')
  writeFileSync(zipPath, buf)

  let integrity = ''
  try {
    integrity = execFileSync('unzip', ['-t', zipPath], { encoding: 'utf8' })
  } catch (err) {
    integrity = `FAILED ${err && err.message}`
  }
  check('unzip -t CRC 校验通过', /No errors detected/.test(integrity), integrity.split('\n').slice(-2).join(' '))

  // 用认 UTF-8 标志位的权威实现校验文件名（macOS 自带的 Info-ZIP unzip 默认忽略该标志位，
  // 会把中文名显示成乱码，那是它自己的 locale 处理问题，不是 ZIP 内容有问题）。
  const pyNames = (() => {
    try {
      return execFileSync(
        'python3',
        ['-c', 'import sys,zipfile;print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))', zipPath],
        { encoding: 'utf8' },
      )
        .trim()
        .split('\n')
        .filter(Boolean)
    } catch {
      return []
    }
  })()
  check('zip 内含中文文件名（python zipfile）', pyNames.includes('sub/deep/中文文件.txt'), pyNames.join(' | '))
  check('zip 保留目录层级与目录条目', pyNames.includes('sub/deep/') && pyNames.includes('sub/into-sub.txt'), pyNames.join(' | '))

  let pyCrc = ''
  try {
    pyCrc = execFileSync(
      'python3',
      ['-c', 'import sys,zipfile;print("OK" if zipfile.ZipFile(sys.argv[1]).testzip() is None else "BAD")', zipPath],
      { encoding: 'utf8' },
    ).trim()
  } catch {
    pyCrc = 'ERR'
  }
  check('zip 全条目 CRC 自检 OK', pyCrc === 'OK', pyCrc)

  // Finder 同款解包器（ditto）真解一遍，确认中文名落盘正确
  const extractDir = join(base, 'extract')
  let dittoOk = false
  try {
    mkdirSync(extractDir, { recursive: true })
    execFileSync('ditto', ['-x', '-k', zipPath, extractDir], { encoding: 'utf8' })
    dittoOk = existsSync(join(extractDir, 'sub', 'deep', '中文文件.txt'))
    if (dittoOk) dittoOk = readFileSync(join(extractDir, 'sub', 'deep', '中文文件.txt'), 'utf8') === '中文内容\n'
  } catch {
    dittoOk = false
  }
  check('ditto（Finder 同款）解包中文名正确', dittoOk)

  const multi = await get('/zip', { path: 'hello.txt' })
  const multiReq = new URL(`${API}/zip`)
  multiReq.searchParams.set('sessionId', SESSION)
  multiReq.searchParams.append('path', 'hello.txt')
  multiReq.searchParams.append('path', 'binary.bin')
  const mres = await fetch(multiReq)
  const mbuf = Buffer.from(await mres.arrayBuffer())
  const mpath = join(base, 'multi.zip')
  writeFileSync(mpath, mbuf)
  let mok = ''
  try {
    mok = execFileSync('unzip', ['-t', mpath], { encoding: 'utf8' })
  } catch (err) {
    mok = `FAILED ${err && err.message}`
  }
  check('多选打包校验通过', /No errors detected/.test(mok), mok.split('\n').slice(-2).join(' '))
  await multi.text()

  const none = await getJson('/zip', {})
  check('zip 缺 path → 400', none.status === 400, `got ${none.status}`)
}

console.log('\n── 7. text / write（在线编辑 + 冲突检测）──')
{
  const t = await getJson('/text', { path: 'hello.txt' })
  check('读文本', t.status === 200 && t.body.text === 'hello world\n')
  check('带回 mtimeMs/size', typeof t.body.mtimeMs === 'number' && t.body.size === 12)

  const bin = await getJson('/text', { path: 'binary.bin' })
  check('二进制拒绝编辑 → 415', bin.status === 415, `got ${bin.status}`)

  const w = await postJson('/write', { path: 'hello.txt', text: 'edited\n', expected: { mtimeMs: t.body.mtimeMs, size: t.body.size } })
  check('正常保存', w.status === 200 && readFileSync(join(ROOT, 'hello.txt'), 'utf8') === 'edited\n', JSON.stringify(w.body))

  const stale = await postJson('/write', { path: 'hello.txt', text: 'conflict\n', expected: { mtimeMs: t.body.mtimeMs, size: t.body.size } })
  check('stale expected → 409', stale.status === 409, `got ${stale.status} ${JSON.stringify(stale.body)}`)
  check('冲突时未覆盖文件', readFileSync(join(ROOT, 'hello.txt'), 'utf8') === 'edited\n')

  const fresh = { mtimeMs: w.body.mtimeMs, size: w.body.size }
  const w2 = await postJson('/write', { path: 'new-by-editor.txt', text: 'created\n' })
  check('写新文件', w2.status === 200 && readFileSync(join(ROOT, 'new-by-editor.txt'), 'utf8') === 'created\n')
  const w3 = await postJson('/write', { path: 'hello.txt', text: 'again\n', expected: fresh })
  check('正确 expected 可再次保存', w3.status === 200, JSON.stringify(w3.body))
  check('无 .tmp 残留', !readdirHasPart(ROOT))
}

console.log('\n── 8. create / rename / delete ──')
{
  const c1 = await postJson('/create', { dir: 'sub', name: 'new.txt', kind: 'file', text: 'hi' })
  check('新建文件', c1.status === 200 && readFileSync(join(ROOT, 'sub/new.txt'), 'utf8') === 'hi')
  const c2 = await postJson('/create', { dir: '', name: '新目录', kind: 'dir' })
  check('新建中文名文件夹', c2.status === 200 && existsSync(join(ROOT, '新目录')))
  const c3 = await postJson('/create', { dir: 'sub', name: 'new.txt', kind: 'file' })
  check('重名 → 409', c3.status === 409, `got ${c3.status}`)
  const c4 = await postJson('/create', { dir: '', name: '../evil', kind: 'file' })
  check('非法名 → 400', c4.status === 400, `got ${c4.status}`)

  const r1 = await postJson('/rename', { path: 'sub/new.txt', name: 'renamed.txt' })
  check('重命名', r1.status === 200 && existsSync(join(ROOT, 'sub/renamed.txt')) && !existsSync(join(ROOT, 'sub/new.txt')))
  const r2 = await postJson('/rename', { path: 'sub/renamed.txt', name: 'into-sub.txt' })
  check('重命名撞名 → 409', r2.status === 409, `got ${r2.status}`)
  const r3 = await postJson('/rename', { path: '', name: 'x' })
  check('拒绝重命名工作区根 → 403', r3.status === 403, `got ${r3.status}`)

  const d0 = await postJson('/delete', { paths: [''] })
  check('拒绝删除工作区根 → 403', d0.status === 403, `got ${d0.status}`)

  const del = await postJson('/delete', { paths: ['sub/renamed.txt', '新目录'] })
  check('删除成功', del.status === 200 && del.body.removed.length === 2, JSON.stringify(del.body))
  check('已从工作区移除', !existsSync(join(ROOT, 'sub/renamed.txt')) && !existsSync(join(ROOT, '新目录')))
  const trashEntries = require('node:fs').readdirSync(TRASH, { recursive: true })
  check('进入了回收目录', trashEntries.some((p) => String(p).includes('renamed.txt')) && trashEntries.some((p) => String(p).includes('新目录')), trashEntries.join(','))

  const perm = await postJson('/delete', { paths: ['picked'], permanent: true })
  check('彻底删除目录', perm.status === 200 && !existsSync(join(ROOT, 'picked')))
}

console.log('\n── 9. 未知路由 ──')
{
  const r = await getJson('/nope')
  check('未知路由 → 404', r.status === 404, `got ${r.status}`)
}

server.close()
rmSync(base, { recursive: true, force: true })

console.log(`\n${'─'.repeat(52)}`)
if (failures.length) {
  console.log(`结果：${pass} 通过，${failures.length} 失败`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`结果：全部 ${pass} 项通过 ✓`)
