/* 由 scripts/build-client.mjs 从 client/index.js 生成 —— 请勿手改。
 * 重新生成：npm run build:client
 */
window.__ModuleLoader__.load({
  id: "@tom2012/dsh-file-tree",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
    'use strict'

    /**
     * @tom2012/dsh-file-tree — Client half
     *
     * 在右侧侧边栏接管原生「文件」标签页（kind="files" 的 extension 档），
     * 在原生浏览能力（懒加载目录树 + 点文件打开右侧预览）之上增加：
     *   · 上传单个/多个文件、整个文件夹（拖拽或选择）
     *   · 下载单个文件、打包下载文件夹/多选（宿主流式生成 ZIP）
     *   · 右键菜单：复制相对路径 / 复制绝对路径 / 复制文件名 / 下载 / 上传到此目录 /
     *     新建 / 重命名 / 删除 / @ 到对话框
     *   · 新建文件·文件夹、重命名、删除（默认进回收目录）
     *   · 在线编辑并保存（mtime+size 冲突检测、原子写）
     *
     * 数据通道：宿主同源路由 /-/filetree/*，服务端以"该 sessionId 会话的工作区"为根。
     *
     * 本文件必须自包含（除 wrapper 注入的 React 外不得 import），由 scripts/build-client.mjs
     * 包装成 client/bundle.js。
     */

    const ID = '@tom2012/dsh-file-tree'
    const API = '/-/filetree'

    const ENC = (s) => encodeURIComponent(s).replace(/%3A/gi, ':')
    const ENC_PATH = (p) => p.split('/').map(ENC).join('/')

    /**
     * 文件在资源模型里的地址（与 @deepseek-ai/dsh-client-ui-chat 的构造规则一致）。
     * @param {string} sessionId
     * @param {string} rel 工作区相对路径
     */
    function fileAddress(sessionId, rel) {
      const normalized = String(rel).replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
      return `dsh-resource://file/session/${ENC(sessionId)}/${ENC_PATH(normalized)}`
    }

    /* ------------------------------------------------------------------ *
     * 样式
     * ------------------------------------------------------------------ */

    const CSS = `
    .ft-root{display:flex;flex-direction:column;height:100%;min-height:200px;overflow:hidden;color:var(--dsw-alias-label-primary);box-sizing:border-box;font-size:13px}
    .ft-bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
    .ft-btn{font-size:12px;padding:4px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;flex:none;white-space:nowrap}
    .ft-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 24%,var(--dsw-alias-border-l2))}
    .ft-btn:disabled{opacity:.45;cursor:default}
    .ft-btn-primary{border-color:color-mix(in srgb,var(--dsw-alias-label-primary) 34%,var(--dsw-alias-border-l2))}
    .ft-crumb{padding:6px 10px;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));word-break:break-all;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
    .ft-search{margin:6px 10px 0;flex:none}
    .ft-search input{width:100%;box-sizing:border-box;font-size:12px;padding:4px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}
    .ft-tree{flex:1;overflow:auto;padding:6px 4px 16px}
    .ft-row{display:flex;align-items:center;gap:5px;padding:2px 6px;border-radius:6px;cursor:default;white-space:nowrap;position:relative}
    .ft-row:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
    .ft-row.ft-sel{background:color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent)}
    .ft-row.ft-droptarget{outline:1px dashed color-mix(in srgb,var(--dsw-alias-label-primary) 45%,transparent);outline-offset:-1px}
    .ft-chev{width:13px;flex:none;text-align:center;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:10px;user-select:none}
    .ft-ico{width:16px;flex:none;text-align:center;font-size:12px}
    .ft-name{overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
    .ft-name.ft-dir{color:var(--dsw-alias-label-primary);font-weight:500}
    .ft-size{flex:none;font-size:10px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-family:var(--ds-font-family-code,ui-monospace,monospace);padding-left:6px}
    .ft-kids{margin-left:9px;border-left:1px solid var(--dsw-alias-border-l2);padding-left:2px}
    .ft-msg{padding:8px 12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
    .ft-msg-err{color:var(--dsw-alias-label-error,#e5484d)}
    .ft-empty{padding:14px;font-size:12px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));text-align:center}
    .ft-menu{position:fixed;z-index:99999;min-width:186px;padding:4px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base,#fff);box-shadow:0 8px 28px rgba(0,0,0,.22)}
    .ft-mi{display:block;width:100%;text-align:left;font-size:12px;padding:6px 10px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;white-space:nowrap}
    .ft-mi:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent)}
    .ft-mi-danger{color:var(--dsw-alias-label-error,#e5484d)}
    .ft-sep{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l2)}
    .ft-mask{position:fixed;inset:0;z-index:99998;background:transparent}
    .ft-panel-overlay{position:absolute;inset:0;z-index:50;background:var(--dsw-alias-bg-base,#fff);display:flex;flex-direction:column}
    .ft-panel-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);flex:none}
    .ft-panel-title{flex:1;min-width:0;font-size:12px;font-family:var(--ds-font-family-code,ui-monospace,monospace);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ft-editor{flex:1;width:100%;box-sizing:border-box;border:0;outline:0;resize:none;padding:10px;font-size:12px;line-height:1.5;font-family:var(--ds-font-family-code,ui-monospace,monospace);background:transparent;color:inherit}
    .ft-dialog-mask{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.32);display:flex;align-items:center;justify-content:center}
    .ft-dialog{min-width:300px;max-width:min(90vw,460px);padding:16px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base,#fff);box-shadow:0 16px 48px rgba(0,0,0,.3)}
    .ft-dialog h4{margin:0 0 10px;font-size:13px}
    .ft-dialog p{margin:0 0 12px;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6;word-break:break-all}
    .ft-dialog input{width:100%;box-sizing:border-box;font-size:13px;padding:6px 9px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:inherit}
    .ft-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
    .ft-ups{flex:none;border-top:1px solid var(--dsw-alias-border-l2);max-height:108px;overflow:auto;padding:4px 10px}
    .ft-up{display:flex;gap:8px;align-items:center;font-size:11px;padding:3px 0}
    .ft-up-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .ft-up-bar{flex:none;width:70px;height:4px;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 18%,transparent);overflow:hidden}
    .ft-up-fill{height:100%;background:var(--dsw-alias-label-primary);transition:width .15s}
    .ft-toast{position:absolute;left:10px;right:10px;bottom:10px;z-index:60;padding:7px 10px;border-radius:8px;font-size:12px;background:var(--dsw-alias-bg-base,#fff);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 6px 20px rgba(0,0,0,.2)}
    `

    function injectStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-plugin="dsh-file-tree"]')) return
      const style = document.createElement('style')
      style.setAttribute('data-plugin', 'dsh-file-tree')
      style.textContent = CSS
      document.head.appendChild(style)
    }

    /* ------------------------------------------------------------------ *
     * HTTP / 工具
     * ------------------------------------------------------------------ */

    function qs(sessionId, extra) {
      const parts = [`sessionId=${encodeURIComponent(sessionId)}`]
      if (extra) {
        for (const [k, v] of Object.entries(extra)) {
          if (v === undefined || v === null) continue
          parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        }
      }
      return parts.join('&')
    }

    async function getJson(url) {
      const res = await fetch(url, { credentials: 'same-origin' })
      let body = null
      try {
        body = await res.json()
      } catch {
        throw new Error(`HTTP ${res.status}`)
      }
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
      return body
    }

    async function postJson(url, payload) {
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      let body = null
      try {
        body = await res.json()
      } catch {
        throw new Error(`HTTP ${res.status}`)
      }
      if (!res.ok || body.ok === false) throw new Error(body.error || `HTTP ${res.status}`)
      return body
    }

    function listDir(sessionId, rel) {
      return getJson(`${API}/list?${qs(sessionId, { path: rel || '' })}`)
    }

    function readText(sessionId, rel) {
      return getJson(`${API}/text?${qs(sessionId, { path: rel })}`)
    }

    function writeText(sessionId, rel, text, expected) {
      return postJson(`${API}/write?${qs(sessionId)}`, { path: rel, text, expected })
    }

    function createEntry(sessionId, dir, name, kind, text) {
      return postJson(`${API}/create?${qs(sessionId)}`, { dir, name, kind, text })
    }

    function renameEntry(sessionId, rel, name) {
      return postJson(`${API}/rename?${qs(sessionId)}`, { path: rel, name })
    }

    function deleteEntries(sessionId, paths, permanent) {
      return postJson(`${API}/delete?${qs(sessionId)}`, { paths, permanent })
    }

    function uploadUrl(sessionId, dir) {
      return `${API}/upload?${qs(sessionId, { path: dir || '' })}`
    }

    /** 用 XHR 上传以获得进度。 */
    function uploadOne(sessionId, dir, file, relName, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', uploadUrl(sessionId, dir), true)
        xhr.withCredentials = true
        xhr.setRequestHeader('Content-Type', 'application/octet-stream')
        xhr.setRequestHeader('x-file-rel', encodeURIComponent(relName))
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
        }
        xhr.onload = () => {
          let body = null
          try {
            body = JSON.parse(xhr.responseText)
          } catch {
            /* 非 JSON */
          }
          if (xhr.status >= 200 && xhr.status < 300 && body && body.ok) resolve(body)
          else reject(new Error((body && body.error) || `HTTP ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('网络错误'))
        xhr.onabort = () => reject(new Error('已取消'))
        xhr.send(file)
      })
    }

    function triggerDownload(url) {
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      setTimeout(() => a.remove(), 0)
    }

    async function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        /* 退化到 execCommand */
      }
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        return ok
      } catch {
        return false
      }
    }

    /** 把 @绝对路径 注入对话框（composer 双形态兼容：textarea / contenteditable）。 */
    function insertComposerRef(absPath) {
      const text = `@${absPath} `
      try {
        const card = document.querySelector('[data-composer-card]')
        const ta = card && card.querySelector('textarea')
        const ce = card && (card.querySelector('[contenteditable="true"]') || card.querySelector('[contenteditable=""]'))
        if (typeof document.execCommand === 'function' && (ta || ce)) {
          if (ta) {
            ta.focus()
            const len = ta.value ? ta.value.length : 0
            try {
              ta.setSelectionRange(len, len)
            } catch {
              /* 某些浏览器不支持 */
            }
          } else {
            ce.focus()
            const sel = window.getSelection()
            const range = document.createRange()
            range.selectNodeContents(ce)
            range.collapse(false)
            sel.removeAllRanges()
            sel.addRange(range)
          }
          if (document.execCommand('insertText', false, text)) return true
        }
      } catch {
        /* 落到剪贴板 */
      }
      copyText(text)
      return false
    }

    function joinAbs(cwd, rel) {
      if (!rel) return cwd
      return `${String(cwd).replace(/[/\\]+$/, '')}/${rel}`
    }

    function formatSize(n) {
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return ''
      if (n < 1024) return `${n} B`
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`
      if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
      return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
    }

    const EXT_ICON = {
      dir: '📁',
      md: '📝', markdown: '📝', txt: '📄', log: '📄',
      json: '🔧', yaml: '🔧', yml: '🔧', toml: '🔧', ini: '🔧', conf: '🔧',
      js: '📜', mjs: '📜', cjs: '📜', ts: '📜', tsx: '📜', jsx: '📜',
      py: '🐍', rb: '💎', go: '🐹', rs: '🦀', java: '☕', kt: '☕',
      sh: '⌨️', bash: '⌨️', zsh: '⌨️', fish: '⌨️',
      html: '🌐', htm: '🌐', css: '🎨', scss: '🎨', less: '🎨', vue: '🎨', svelte: '🎨',
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', bmp: '🖼️', ico: '🖼️', svg: '🖼️', avif: '🖼️',
      pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', csv: '📗', tsv: '📗', ppt: '📙', pptx: '📙',
      zip: '🗜️', gz: '🗜️', tar: '🗜️', tgz: '🗜️', bz2: '🗜️', xz: '🗜️', '7z': '🗜️', rar: '🗜️',
      mp3: '🎵', wav: '🎵', flac: '🎵', m4a: '🎵', mp4: '🎬', mov: '🎬', mkv: '🎬', avi: '🎬', webm: '🎬',
      lock: '🔒', env: '🔑', key: '🔑', pem: '🔑',
    }

    function iconFor(entry) {
      if (entry.type === 'dir') return EXT_ICON.dir
      const name = entry.name || ''
      const dot = name.lastIndexOf('.')
      if (dot > 0) {
        const ext = name.slice(dot + 1).toLowerCase()
        if (EXT_ICON[ext]) return EXT_ICON[ext]
      }
      return '📄'
    }

    /* ------------------------------------------------------------------ *
     * 小组件：对话框
     * ------------------------------------------------------------------ */

    function Dialog(props) {
      const { title, message, defaultValue, confirmLabel, danger, onCancel, onConfirm } = props
      const [value, setValue] = React.useState(defaultValue === undefined ? null : defaultValue)
      const inputRef = React.useRef(null)

      React.useEffect(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          if (defaultValue !== undefined) {
            const dot = String(defaultValue).lastIndexOf('.')
            if (dot > 0) inputRef.current.setSelectionRange(0, dot)
            else inputRef.current.select()
          }
        }
      }, [])

      const submit = () => {
        if (value === null) onConfirm(undefined)
        else if (String(value).trim()) onConfirm(String(value).trim())
      }

      return React.createElement(
        'div',
        { className: 'ft-dialog-mask', onMouseDown: (e) => e.target === e.currentTarget && onCancel() },
        React.createElement(
          'div',
          {
            className: 'ft-dialog',
            onKeyDown: (e) => {
              if (e.key === 'Escape') onCancel()
              if (e.key === 'Enter') submit()
            },
          },
          React.createElement('h4', null, title),
          message ? React.createElement('p', null, message) : null,
          value === null
            ? null
            : React.createElement('input', {
                ref: inputRef,
                value,
                onChange: (e) => setValue(e.target.value),
              }),
          React.createElement(
            'div',
            { className: 'ft-dialog-actions' },
            React.createElement('button', { className: 'ft-btn', onClick: onCancel }, '取消'),
            React.createElement(
              'button',
              {
                className: `ft-btn ${danger ? 'ft-mi-danger' : 'ft-btn-primary'}`,
                onClick: submit,
              },
              confirmLabel || '确定',
            ),
          ),
        ),
      )
    }

    /* ------------------------------------------------------------------ *
     * 主体
     * ------------------------------------------------------------------ */

    function FileTree(props) {
      const sessionId = props && props.sessionId
      // 与原生 FilesBody 一样，从当前 tab 的 hook 取 actions；这样文件预览一定
      // 落在本 tab 所属的会话/面板，而不是依赖一个全局“当前会话”。
      const tabInfo = props && typeof props.useTabInfo === 'function' ? props.useTabInfo() : null

      const [workspace, setWorkspace] = React.useState(null)
      const [fatal, setFatal] = React.useState(null)
      const [nodes, setNodes] = React.useState({})
      const [expanded, setExpanded] = React.useState(() => new Set(['']))
      const [selected, setSelected] = React.useState(() => new Set())
      const [query, setQuery] = React.useState('')
      const [menu, setMenu] = React.useState(null)
      const [dialog, setDialog] = React.useState(null)
      const [editing, setEditing] = React.useState(null)
      const [uploads, setUploads] = React.useState([])
      const [toast, setToast] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [dropDir, setDropDir] = React.useState(null)

      const fileInputRef = React.useRef(null)
      const dirInputRef = React.useRef(null)
      const uploadTargetRef = React.useRef('')
      const toastTimer = React.useRef(null)
      const rootRef = React.useRef(null)

      const flash = React.useCallback((text, isError) => {
        setToast({ text, isError: Boolean(isError) })
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(null), isError ? 6000 : 2600)
      }, [])

      React.useEffect(() => () => {
        if (toastTimer.current) clearTimeout(toastTimer.current)
      }, [])

      const loadDir = React.useCallback(
        async (rel) => {
          if (!sessionId) return
          setNodes((prev) => ({ ...prev, [rel]: { status: 'loading', entries: prev[rel] ? prev[rel].entries : [] } }))
          try {
            const data = await listDir(sessionId, rel)
            const entries = Array.isArray(data.entries) ? data.entries : []
            setNodes((prev) => ({ ...prev, [rel]: { status: 'ready', entries } }))
          } catch (err) {
            setNodes((prev) => ({
              ...prev,
              [rel]: { status: 'error', entries: [], error: String((err && err.message) || err) },
            }))
          }
        },
        [sessionId],
      )

      // 首次挂载 / session 切换：取工作区并列出根目录
      React.useEffect(() => {
        if (!sessionId) return
        let alive = true
        setWorkspace(null)
        setFatal(null)
        setNodes({})
        setExpanded(new Set(['']))
        setSelected(new Set())
        setQuery('')
        setEditing(null)
        getJson(`${API}/status?${qs(sessionId)}`)
          .then((data) => {
            if (!alive) return
            setWorkspace(data.workspace)
            return loadDir('')
          })
          .catch((err) => {
            if (alive) setFatal(String((err && err.message) || err))
          })
        return () => {
          alive = false
        }
      }, [sessionId, loadDir])

      // 关闭右键菜单
      React.useEffect(() => {
        if (!menu) return undefined
        const close = () => setMenu(null)
        const onKey = (e) => e.key === 'Escape' && setMenu(null)
        window.addEventListener('scroll', close, true)
        window.addEventListener('resize', close)
        window.addEventListener('keydown', onKey)
        return () => {
          window.removeEventListener('scroll', close, true)
          window.removeEventListener('resize', close)
          window.removeEventListener('keydown', onKey)
        }
      }, [menu])

      const refresh = (rel) => loadDir(rel === undefined ? '' : rel)

      const reloadLoaded = React.useCallback(() => {
        setNodes((prev) => {
          Object.keys(prev).forEach((rel) => {
            loadDir(rel)
          })
          return prev
        })
      }, [loadDir])

      // 保留原生文件树的刷新命令（包括宿主给的刷新快捷键）。
      const tabActions = tabInfo && tabInfo.tab && tabInfo.tab.actions
      React.useEffect(() => {
        if (!tabActions || typeof tabActions.bindCommands !== 'function') return undefined
        return tabActions.bindCommands({ refresh: reloadLoaded })
      }, [tabActions, reloadLoaded])

      const toggleDir = (rel) => {
        setExpanded((prev) => {
          const next = new Set(prev)
          if (next.has(rel)) next.delete(rel)
          else next.add(rel)
          return next
        })
        if (!nodes[rel] || nodes[rel].status === 'error') loadDir(rel)
      }

      const openFile = (rel) => {
        const address = fileAddress(sessionId, rel)
        const tabActions = tabInfo && tabInfo.tab && tabInfo.tab.actions
        const svc = serviceRef.sidebarRight
        try {
          if (tabActions && typeof tabActions.openResource === 'function') {
            tabActions.openResource(address)
            return
          }
          if (svc && typeof svc.openResource === 'function') {
            svc.openResource(address)
            return
          }
        } catch (err) {
          flash(`打开预览失败：${(err && err.message) || err}`, true)
          return
        }
        flash('右侧预览服务不可用，无法打开文件', true)
      }

      /* ---------------- 上传 ---------------- */

      const runUploads = async (dirRel, fileList) => {
        const files = Array.from(fileList || [])
        if (!files.length) return
        const items = files.map((f, i) => ({
          key: `${Date.now()}-${i}`,
          name: f.webkitRelativePath || f.name,
          progress: 0,
          error: null,
        }))
        setUploads((prev) => [...prev, ...items])
        let failed = 0
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const item = items[i]
          const relName = file.webkitRelativePath || file.name
          try {
            await uploadOne(sessionId, dirRel, file, relName, (p) => {
              setUploads((prev) => prev.map((u) => (u.key === item.key ? { ...u, progress: p } : u)))
            })
            setUploads((prev) => prev.map((u) => (u.key === item.key ? { ...u, progress: 1 } : u)))
          } catch (err) {
            failed++
            setUploads((prev) =>
              prev.map((u) => (u.key === item.key ? { ...u, error: String((err && err.message) || err) } : u)),
            )
          }
        }
        const targetDir = dirRel
        // 展开并刷新目标目录，让用户立刻看到结果
        setExpanded((prev) => new Set(prev).add(targetDir))
        await loadDir(targetDir)
        if (dirRel.includes('/')) await loadDir(dirRel.split('/').slice(0, -1).join('/'))
        flash(failed ? `上传完成，${failed} 个失败` : `已上传 ${files.length} 个文件`, failed > 0)
        setTimeout(() => setUploads((prev) => prev.filter((u) => !items.some((it) => it.key === u.key))), 2200)
      }

      const pickUpload = (dirRel) => {
        uploadTargetRef.current = dirRel || ''
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
          fileInputRef.current.click()
        }
      }

      const pickUploadDir = (dirRel) => {
        uploadTargetRef.current = dirRel || ''
        if (dirInputRef.current) {
          dirInputRef.current.value = ''
          dirInputRef.current.click()
        }
      }

      /* ---------------- 下载 ---------------- */

      const downloadFile = (rel) => {
        triggerDownload(`${API}/download?${qs(sessionId, { path: rel })}`)
      }

      const downloadZip = (paths) => {
        const list = Array.isArray(paths) ? paths : [paths]
        if (!list.length) return
        const parts = [`sessionId=${encodeURIComponent(sessionId)}`]
        for (const p of list) parts.push(`path=${encodeURIComponent(p)}`)
        triggerDownload(`${API}/zip?${parts.join('&')}`)
      }

      /* ---------------- 增删改 ---------------- */

      const askNew = (dirRel) => {
        setDialog({
          title: '新建文件',
          message: `位置：${joinAbs(workspace, dirRel)}`,
          defaultValue: 'untitled.txt',
          confirmLabel: '创建',
          onConfirm: async (name) => {
            setDialog(null)
            if (!name) return
            setBusy(true)
            try {
              await createEntry(sessionId, dirRel, name, 'file', '')
              await loadDir(dirRel)
              flash(`已创建 ${name}`)
            } catch (err) {
              flash(String((err && err.message) || err), true)
            } finally {
              setBusy(false)
            }
          },
        })
      }

      const askNewDir = (dirRel) => {
        setDialog({
          title: '新建文件夹',
          message: `位置：${joinAbs(workspace, dirRel)}`,
          defaultValue: 'new-folder',
          confirmLabel: '创建',
          onConfirm: async (name) => {
            setDialog(null)
            if (!name) return
            setBusy(true)
            try {
              await createEntry(sessionId, dirRel, name, 'dir')
              await loadDir(dirRel)
              flash(`已创建 ${name}`)
            } catch (err) {
              flash(String((err && err.message) || err), true)
            } finally {
              setBusy(false)
            }
          },
        })
      }

      const askRename = (rel) => {
        const base = rel.split('/').pop()
        setDialog({
          title: '重命名',
          message: joinAbs(workspace, rel),
          defaultValue: base,
          confirmLabel: '重命名',
          onConfirm: async (name) => {
            setDialog(null)
            if (!name || name === base) return
            setBusy(true)
            try {
              await renameEntry(sessionId, rel, name)
              await loadDir(rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : '')
              flash(`已重命名为 ${name}`)
            } catch (err) {
              flash(String((err && err.message) || err), true)
            } finally {
              setBusy(false)
            }
          },
        })
      }

      const askDelete = (paths) => {
        const list = Array.isArray(paths) ? paths : [paths]
        if (!list.length) return
        const label = list.length === 1 ? joinAbs(workspace, list[0]) : `${list.length} 个项目`
        setDialog({
          title: '删除',
          message: `${label}\n\n默认移入回收目录（~/.dsh-file-tree-trash），可在确认后再选择彻底删除。`,
          confirmLabel: '移入回收目录',
          danger: true,
          onConfirm: async () => {
            setDialog(null)
            setBusy(true)
            try {
              await deleteEntries(sessionId, list, false)
              const dirs = new Set(list.map((p) => (p.includes('/') ? p.split('/').slice(0, -1).join('/') : '')))
              for (const d of dirs) await loadDir(d)
              setSelected(new Set())
              flash(`已移入回收目录：${list.length} 项`)
            } catch (err) {
              flash(String((err && err.message) || err), true)
            } finally {
              setBusy(false)
            }
          },
        })
      }

      /* ---------------- 编辑 ---------------- */

      const openEditor = async (rel) => {
        setBusy(true)
        try {
          const data = await readText(sessionId, rel)
          setEditing({ rel, text: data.text, mtimeMs: data.mtimeMs, size: data.size, truncated: data.truncated, error: null })
        } catch (err) {
          flash(String((err && err.message) || err), true)
        } finally {
          setBusy(false)
        }
      }

      const saveEditor = async () => {
        if (!editing) return
        setBusy(true)
        try {
          const data = await writeText(sessionId, editing.rel, editing.text, {
            mtimeMs: editing.mtimeMs,
            size: editing.size,
          })
          setEditing({ ...editing, mtimeMs: data.mtimeMs, size: data.size, error: null })
          flash('已保存')
          await loadDir(editing.rel.includes('/') ? editing.rel.split('/').slice(0, -1).join('/') : '')
        } catch (err) {
          const msg = String((err && err.message) || err)
          setEditing((prev) => (prev ? { ...prev, error: msg } : prev))
          flash(msg, true)
        } finally {
          setBusy(false)
        }
      }

      /* ---------------- 渲染 ---------------- */

      if (!sessionId) {
        return React.createElement('div', { className: 'ft-msg' }, '等待会话…')
      }
      if (fatal) {
        return React.createElement('div', { className: 'ft-msg ft-msg-err' }, `文件树不可用：${fatal}`)
      }

      const matches = (entry) => {
        if (!query.trim()) return true
        return entry.name.toLowerCase().includes(query.trim().toLowerCase())
      }

      const renderDir = (rel, depth) => {
        const node = nodes[rel]
        if (!node) return null
        if (node.status === 'loading' && !node.entries.length) {
          return React.createElement('div', { className: 'ft-msg' }, '载入中…')
        }
        if (node.status === 'error') {
          return React.createElement(
            'div',
            { className: 'ft-msg ft-msg-err' },
            `读取失败：${node.error}`,
            React.createElement('button', { className: 'ft-btn', style: { marginLeft: 8 }, onClick: () => loadDir(rel) }, '重试'),
          )
        }
        const visible = node.entries.filter(matches)
        if (!visible.length) {
          if (rel === '' && !query.trim()) return React.createElement('div', { className: 'ft-empty' }, '工作区是空的')
          return React.createElement('div', { className: 'ft-msg' }, query.trim() ? '无匹配项' : '空目录')
        }
        return visible.map((entry) => {
          const childRel = rel ? `${rel}/${entry.name}` : entry.name
          const isDir = entry.type === 'dir'
          const isOpen = expanded.has(childRel)
          return React.createElement(
            'div',
            { key: childRel },
            React.createElement(
              'div',
              {
                className: `ft-row${selected.has(childRel) ? ' ft-sel' : ''}${
                  dropDir === childRel && isDir ? ' ft-droptarget' : ''
                }`,
                title: childRel,
                onClick: (e) => {
                  if (isDir) toggleDir(childRel)
                  else if (e.metaKey || e.ctrlKey) {
                    setSelected((prev) => {
                      const next = new Set(prev)
                      if (next.has(childRel)) next.delete(childRel)
                      else next.add(childRel)
                      return next
                    })
                  } else {
                    setSelected(new Set([childRel]))
                    openFile(childRel)
                  }
                },
                onContextMenu: (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setMenu({ x: e.clientX, y: e.clientY, rel: childRel, name: entry.name, isDir })
                },
                onDragOver: isDir
                  ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (dropDir !== childRel) setDropDir(childRel)
                    }
                  : undefined,
                onDragLeave: isDir ? () => setDropDir((d) => (d === childRel ? null : d)) : undefined,
                onDrop: isDir
                  ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setDropDir(null)
                      runUploads(childRel, e.dataTransfer.files)
                    }
                  : undefined,
              },
              React.createElement('span', { className: 'ft-chev' }, isDir ? (isOpen ? '▾' : '▸') : ''),
              React.createElement('span', { className: 'ft-ico' }, iconFor(entry)),
              React.createElement('span', { className: `ft-name${isDir ? ' ft-dir' : ''}` }, entry.name),
              !isDir && entry.size ? React.createElement('span', { className: 'ft-size' }, formatSize(entry.size)) : null,
            ),
            isDir && isOpen ? React.createElement('div', { className: 'ft-kids' }, renderDir(childRel, depth + 1)) : null,
          )
        })
      }

      const menuItems = []
      if (menu) {
        const rel = menu.rel
        const abs = joinAbs(workspace, rel)
        menuItems.push({ label: '复制相对路径', run: () => copyText(rel).then((ok) => flash(ok ? `已复制：${rel}` : '复制失败', !ok)) })
        menuItems.push({ label: '复制绝对路径', run: () => copyText(abs).then((ok) => flash(ok ? `已复制：${abs}` : '复制失败', !ok)) })
        menuItems.push({ label: '复制文件名', run: () => copyText(menu.name).then((ok) => flash(ok ? `已复制：${menu.name}` : '复制失败', !ok)) })
        menuItems.push({ sep: true })
        menuItems.push({ label: '@ 到对话框', run: () => flash(insertComposerRef(abs) ? '已注入对话框' : '已复制到剪贴板（未能自动注入）') })
        menuItems.push({ sep: true })
        if (menu.isDir) {
          menuItems.push({ label: '打包下载此文件夹', run: () => downloadZip(rel) })
          menuItems.push({ label: '上传到此处', run: () => pickUpload(rel) })
          menuItems.push({ label: '上传文件夹到此处', run: () => pickUploadDir(rel) })
          menuItems.push({ sep: true })
          menuItems.push({ label: '新建文件', run: () => askNew(rel) })
          menuItems.push({ label: '新建文件夹', run: () => askNewDir(rel) })
        } else {
          menuItems.push({ label: '下载', run: () => downloadFile(rel) })
          menuItems.push({ label: '编辑', run: () => openEditor(rel) })
        }
        menuItems.push({ sep: true })
        menuItems.push({ label: '重命名', run: () => askRename(rel) })
        menuItems.push({ label: '删除', danger: true, run: () => askDelete([rel]) })
      }

      const selList = Array.from(selected)

      return React.createElement(
        'div',
        {
          className: 'ft-root',
          ref: rootRef,
          style: { position: 'relative' },
          onDragOver: (e) => {
            e.preventDefault()
          },
          onDrop: (e) => {
            // 落在面板空白处 → 上传到根目录
            if (dropDir) return
            e.preventDefault()
            runUploads('', e.dataTransfer.files)
          },
        },
        React.createElement(
          'div',
          { className: 'ft-bar' },
          React.createElement('button', { className: 'ft-btn', disabled: busy, onClick: () => pickUpload('') }, '上传'),
          React.createElement('button', { className: 'ft-btn', disabled: busy, onClick: () => pickUploadDir('') }, '上传文件夹'),
          React.createElement('button', { className: 'ft-btn', disabled: busy, onClick: () => askNew('') }, '新建文件'),
          React.createElement('button', { className: 'ft-btn', disabled: busy, onClick: () => askNewDir('') }, '新建文件夹'),
          React.createElement('button', { className: 'ft-btn', disabled: busy, onClick: reloadLoaded }, '刷新'),
          // 原生 actions 插槽归 sidebar-files entry 所有；当前 entry 未声明它，
          // 不能转发调用，否则会触发 SlotOwnershipError。
          React.createElement('button', { className: 'ft-btn', disabled: busy, onClick: () => setExpanded(new Set([''])) }, '全部折叠'),
          selList.length
            ? React.createElement(
                'button',
                { className: 'ft-btn ft-btn-primary', onClick: () => downloadZip(selList) },
                `打包下载(${selList.length})`,
              )
            : null,
          selList.length
            ? React.createElement('button', { className: 'ft-btn', onClick: () => setSelected(new Set()) }, '取消选择')
            : null,
        ),
        workspace ? React.createElement('div', { className: 'ft-crumb', title: workspace }, workspace) : null,
        React.createElement(
          'div',
          { className: 'ft-search' },
          React.createElement('input', {
            placeholder: '过滤当前已展开的目录…',
            value: query,
            onChange: (e) => setQuery(e.target.value),
          }),
        ),
        React.createElement('div', { className: 'ft-tree' }, renderDir('', 0)),
        uploads.length
          ? React.createElement(
              'div',
              { className: 'ft-ups' },
              uploads.map((u) =>
                React.createElement(
                  'div',
                  { key: u.key, className: 'ft-up' },
                  React.createElement('span', { className: 'ft-up-name', title: u.name }, u.name),
                  u.error
                    ? React.createElement('span', { className: 'ft-msg-err' }, '失败')
                    : React.createElement(
                        'span',
                        { className: 'ft-up-bar' },
                        React.createElement('span', { className: 'ft-up-fill', style: { width: `${Math.round(u.progress * 100)}%` } }),
                      ),
                ),
              ),
            )
          : null,
        toast ? React.createElement('div', { className: `ft-toast${toast.isError ? ' ft-msg-err' : ''}` }, toast.text) : null,
        menu
          ? React.createElement(
              React.Fragment,
              null,
              React.createElement('div', { className: 'ft-mask', onMouseDown: () => setMenu(null), onContextMenu: (e) => e.preventDefault() }),
              React.createElement(
                'div',
                {
                  className: 'ft-menu',
                  style: {
                    left: Math.min(menu.x, Math.max(8, window.innerWidth - 200)),
                    top: Math.min(menu.y, Math.max(8, window.innerHeight - 30 - menuItems.length * 28)),
                  },
                  onMouseDown: (e) => e.stopPropagation(),
                },
                menuItems.map((item, i) =>
                  item.sep
                    ? React.createElement('div', { key: `s${i}`, className: 'ft-sep' })
                    : React.createElement(
                        'button',
                        {
                          key: `i${i}`,
                          className: `ft-mi${item.danger ? ' ft-mi-danger' : ''}`,
                          onClick: () => {
                            setMenu(null)
                            item.run()
                          },
                        },
                        item.label,
                      ),
                ),
              ),
            )
          : null,
        dialog
          ? React.createElement(Dialog, {
              title: dialog.title,
              message: dialog.message,
              defaultValue: dialog.defaultValue,
              confirmLabel: dialog.confirmLabel,
              danger: dialog.danger,
              onCancel: () => setDialog(null),
              onConfirm: dialog.onConfirm,
            })
          : null,
        editing
          ? React.createElement(
              'div',
              { className: 'ft-panel-overlay' },
              React.createElement(
                'div',
                { className: 'ft-panel-head' },
                React.createElement('span', { className: 'ft-panel-title', title: editing.rel }, editing.rel),
                editing.truncated ? React.createElement('span', { className: 'ft-size' }, '已截断') : null,
                React.createElement(
                  'button',
                  { className: 'ft-btn ft-btn-primary', disabled: busy, onClick: saveEditor },
                  busy ? '保存中…' : '保存',
                ),
                React.createElement('button', { className: 'ft-btn', onClick: () => setEditing(null) }, '关闭'),
              ),
              editing.error ? React.createElement('div', { className: 'ft-msg ft-msg-err' }, editing.error) : null,
              React.createElement('textarea', {
                className: 'ft-editor',
                spellCheck: false,
                value: editing.text,
                onChange: (e) => setEditing((prev) => (prev ? { ...prev, text: e.target.value } : prev)),
                onKeyDown: (e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
                    e.preventDefault()
                    saveEditor()
                  }
                },
              }),
            )
          : null,
        React.createElement('input', {
          ref: fileInputRef,
          type: 'file',
          multiple: true,
          style: { display: 'none' },
          onChange: (e) => {
            const files = e.target.files
            if (files && files.length) runUploads(uploadTargetRef.current, files)
          },
        }),
        React.createElement('input', {
          ref: dirInputRef,
          type: 'file',
          multiple: true,
          webkitdirectory: '',
          directory: '',
          style: { display: 'none' },
          onChange: (e) => {
            const files = e.target.files
            if (files && files.length) runUploads(uploadTargetRef.current, files)
          },
        }),
      )
    }

    /* ------------------------------------------------------------------ *
     * 插件
     * ------------------------------------------------------------------ */

    /** apply 期间捕获的服务句柄（组件里用）。 */
    const serviceRef = { sidebarRight: null }

    const inject = ['slots']

    function apply(ctx) {
      injectStyles()

      const registerType = (scope) => {
        const tabs = (scope && scope.sidebarRightTabs) || (typeof ctx.get === 'function' ? ctx.get('sidebarRightTabs') : null)
        const slots = (scope && scope.slots) || (typeof ctx.get === 'function' ? ctx.get('slots') : null)

        if (tabs && typeof tabs.register === 'function') {
          ctx.effect(
            () =>
              tabs.register({
                id: ID,
                kind: 'files', // 与原生同一个 kind，靠 extension 档接管；卸载后原生自动恢复
                priority: 'extension',
                title: () => '文件',
                // extension 接管 kind 后，原生 guide 也随 builtin 一起退下；在这里补回
                // 「新标签页 → 工作区文件」入口，commandId 复用原生已注册的快捷键命令。
                guide: [
                  {
                    id: 'workspace',
                    commandId: 'workspace.files',
                    order: 10,
                    title: () => '工作区文件',
                    description: () => '浏览、上传、下载和管理会话工作区的文件',
                  },
                ],
              }),
            'dsh-file-tree: files tab type',
          )
        } else {
          console.warn('[dsh-file-tree] sidebarRightTabs 不可用，未能注册文件树类型')
        }

        if (slots && typeof slots.inject === 'function' && typeof slots.register === 'function') {
          ctx.effect(
            () =>
              slots.inject('sidebar.right.pane.tab', () =>
                slots.register(
                  {
                    name: 'sidebar.right.pane.tab',
                    key: ID,
                    // actions 插槽由原生 sidebar-files 声明；重复声明会让原生插件激活失败。
                  },
                  (p) => React.createElement(FileTree, p),
                ),
              ),
            'dsh-file-tree: files tab body',
          )
        } else {
          console.warn('[dsh-file-tree] slots 不可用，未能注册文件树面板')
        }

        const sb = (scope && scope.sidebarRight) || (typeof ctx.get === 'function' ? ctx.get('sidebarRight') : null)
        if (sb) serviceRef.sidebarRight = sb
      }

      // sidebarRightTabs / sidebarRight 由 ui-sidebar-right 提供，稍于本插件就绪。
      try {
        ctx.inject(['slots', 'sidebarRightTabs', 'sidebarRight'], registerType)
      } catch (err) {
        console.warn('[dsh-file-tree] inject 失败:', err)
      }
    }

    module.exports = { inject, apply }

    return module.exports
  }
})
