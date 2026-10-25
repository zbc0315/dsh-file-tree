/**
 * 客户端半冒烟测试：不依赖浏览器，验证三件最危险的事：
 *   1. bundle 遵守 __ModuleLoader__ 协议（id、factory、module.exports 形状）；
 *   2. apply() 注册的载荷正确 —— kind="files" + priority="extension" 才能接管原生
 *      「文件」标签页，key 必须等于自己的 id（座位按定义自己的 id 找 body/title）；
 *   3. 用真 React 把面板真渲染一遍，确认 hooks 与首屏渲染路径不抛错。
 *
 * React / ReactDOM 是开发依赖；也可用 FT_REACT_HOME 指向其他已有的 node_modules。
 * 运行：node scripts/client-smoke.mjs
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const REACT_HOME = process.env.FT_REACT_HOME || join(here, '..', 'node_modules')

let React
try {
  React = require(join(REACT_HOME, 'react'))
} catch (err) {
  console.error(`✗ 借不到 react（可用 FT_REACT_HOME 指定）: ${err.message}`)
  process.exit(1)
}
const ReactDOMServer = require(join(REACT_HOME, 'react-dom/server'))

let pass = 0
const failures = []
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ---------- 1. 走 __ModuleLoader__ 协议加载 bundle ---------- */

const bundle = readFileSync(join(here, '..', 'client', 'bundle.js'), 'utf8')

let loaded = null
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (spec) => {
        loaded = spec
      },
    },
  },
  console,
  setTimeout,
  clearTimeout,
  Symbol,
  Object,
  Array,
  JSON,
  Math,
  Number,
  String,
  Boolean,
  Date,
  Set,
  Map,
  Promise,
  Error,
  RegExp,
}
sandbox.globalThis = sandbox
vm.runInNewContext(bundle, sandbox, { filename: 'client/bundle.js' })

console.log('\n── 1. bundle 协议 ──')
check('调用了 window.__ModuleLoader__.load', Boolean(loaded))
check('注册 id 等于包名', loaded && loaded.id === '@tom2012/dsh-file-tree', loaded && loaded.id)
check('factory 是函数', loaded && typeof loaded.factory === 'function')

const plugin = loaded.factory((name) => {
  if (name === 'react') return React
  throw new Error(`客户端 bundle 只能 require react，却被要求: ${name}`)
})

check('module.exports 有 inject', plugin && Array.isArray(plugin.inject), JSON.stringify(plugin && plugin.inject))
check('inject 只声明 slots', JSON.stringify(plugin.inject) === '["slots"]', JSON.stringify(plugin.inject))
check('module.exports 有 apply 函数', plugin && typeof plugin.apply === 'function')

/* ---------- 2. apply() 的注册载荷 ---------- */

console.log('\n── 2. 注册载荷（接管原生 files 标签页的关键）──')
const typeRegs = []
const bodyRegs = []
const injections = []
let effectCount = 0
const fakeSlots = {
  inject: (slotName, fn) => {
    injections.push(slotName)
    fn()
  },
  register: (opts, component) => {
    bodyRegs.push({ opts, component })
    return () => {}
  },
}
const fakeTabs = {
  register: (def) => {
    typeRegs.push(def)
    return () => {}
  },
}
const fakeSidebarRight = { openResource: () => {} }
const fakeCtx = {
  get: (name) => {
    if (name === 'slots') return fakeSlots
    if (name === 'sidebarRightTabs') return fakeTabs
    if (name === 'sidebarRight') return fakeSidebarRight
    return null
  },
  inject: (deps, cb) => {
    injections.push(`deps:${deps.join(',')}`)
    cb({
      slots: fakeSlots,
      sidebarRightTabs: fakeTabs,
      sidebarRight: fakeSidebarRight,
    })
  },
  effect: (fn) => {
    effectCount++
    return fn()
  },
}
const origWarn = console.warn
console.warn = () => {}
plugin.apply(fakeCtx)
console.warn = origWarn

const def = typeRegs[0]
check('注册了 1 个标签页类型', typeRegs.length === 1, `count=${typeRegs.length}`)
check('id 是自己的包名', def && def.id === '@tom2012/dsh-file-tree', def && def.id)
check('kind = "files"（与原生同 kind）', def && def.kind === 'files', def && def.kind)
check('priority = "extension"（才能压过 builtin）', def && def.priority === 'extension', def && def.priority)
check('title() 返回「文件」', def && typeof def.title === 'function' && def.title('x') === '文件', def && typeof def.title)
check(
  '保留「新标签页 → 工作区文件」入口与快捷键命令',
  def && def.guide?.length === 1 && def.guide[0].commandId === 'workspace.files' && def.guide[0].title() === '工作区文件',
)
check('用 ctx.effect 注册（可卸载）', effectCount >= 1, `effects=${effectCount}`)

check('向 sidebar.right.pane.tab 注入面板', injections.includes('sidebar.right.pane.tab'), injections.join(' | '))
check('等待了 sidebarRightTabs/sidebarRight 依赖', injections.some((i) => String(i).startsWith('deps:') && i.includes('sidebarRightTabs')), injections.join(' | '))
const body = bodyRegs[0]
check('注册了 1 个面板', bodyRegs.length === 1, `count=${bodyRegs.length}`)
check('面板 name 正确', body && body.opts.name === 'sidebar.right.pane.tab', body && body.opts.name)
check('面板 key 等于自己的 id（座位按定义 id 找 body）', body && body.opts.key === '@tom2012/dsh-file-tree', body && body.opts.key)
check('面板是组件工厂', body && typeof body.component === 'function')
check(
  '不重复声明原生 files actions 插槽',
  body && (!body.opts.children || !Object.prototype.hasOwnProperty.call(body.opts.children, 'sidebar.right.tab.files.actions')),
)

/* ---------- 3. 真 React 渲染 ---------- */

console.log('\n── 3. 真 React 渲染面板 ──')
let html = ''
let renderError = null
const origError = console.error
console.error = () => {}
try {
  const Comp = body.component
  html = ReactDOMServer.renderToStaticMarkup(React.createElement(Comp, { sessionId: 'smoke-session' }))
} catch (err) {
  renderError = err
} finally {
  console.error = origError
}
check('首屏渲染不抛错', renderError === null, renderError && renderError.message)
check('渲染出了工具栏', html.includes('上传') && html.includes('新建文件夹') && html.includes('刷新'))
check('渲染出了过滤输入框', html.includes('过滤当前已展开的目录'))
check('渲染出了文件选择器', html.includes('type="file"'))

let noSession = ''
try {
  noSession = ReactDOMServer.renderToStaticMarkup(React.createElement(body.component, {}))
} catch (err) {
  noSession = `THREW ${err.message}`
}
check('无 sessionId 时优雅降级', noSession.includes('等待会话'), noSession.slice(0, 60))

/* ---------- 4. 地址构造规则（与 dsh-client-ui-chat 一致）---------- */

console.log('\n── 4. 资源地址构造 ──')
const src = readFileSync(join(here, '..', 'client', 'index.js'), 'utf8')
check(
  '不调用未声明的原生 files actions 插槽',
  !src.includes("renderSlot('sidebar.right.tab.files.actions'") && !src.includes('renderSlot("sidebar.right.tab.files.actions"'),
)
check('使用 dsh-resource://file/session/ 前缀', src.includes('dsh-resource://file/session/'))
check('逐段 encodeURIComponent 且保留 :', /encodeURIComponent\(s\)\.replace\(.%3A./i.test(src))
check('走 sidebarRight.openResource 打开预览', src.includes('openResource'))
check('composer 双形态兼容（textarea + contenteditable）', src.includes('[data-composer-card]') && src.includes('contenteditable'))
check('用 execCommand 注入 @路径', src.includes("insertText"))
check('右键菜单含复制相对/绝对路径', src.includes('复制相对路径') && src.includes('复制绝对路径'))
check('右键菜单含 @ 到对话框', src.includes('@ 到对话框'))
check('含上传/打包下载调用', src.includes('/upload?') && src.includes('/zip?') && src.includes('/download?'))

console.log(`\n${'─'.repeat(52)}`)
if (failures.length) {
  console.log(`结果：${pass} 通过，${failures.length} 失败`)
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`结果：全部 ${pass} 项通过 ✓`)
