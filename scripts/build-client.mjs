/**
 * 由 client/index.js 生成 client/bundle.js。
 *
 * DSH 的静态 client bundle 协议：window.__ModuleLoader__.load({ id, factory })
 * 注册一个 lazy CommonJS factory，其中 react 是 platform module（由宿主提供）。
 * 因此本脚本做的是「包装」而不是「打包」：client/index.js 必须自包含、除 react
 * 外不 import 任何东西。这样插件零构建依赖（不需要 esbuild / rollup）。
 *
 * 运行：npm run build:client
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(here, '..', 'client', 'index.js')
const bundlePath = join(here, '..', 'client', 'bundle.js')
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
const source = readFileSync(sourcePath, 'utf8')

if (/^\s*(import|export)\s/m.test(source)) {
  throw new Error('client/index.js 必须自包含：不能使用 import/export（react 由 wrapper 注入）')
}

const banner = `/* 由 scripts/build-client.mjs 从 client/index.js 生成 —— 请勿手改。
 * 重新生成：npm run build:client
 */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pkg.name)},
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
`

const footer = `
    return module.exports
  }
})
`

const indent = (code) =>
  code
    .split('\n')
    .map((line) => (line.length === 0 ? line : '    ' + line))
    .join('\n')

writeFileSync(bundlePath, banner + indent(source) + footer, 'utf8')
console.log(`built ${bundlePath} (${source.length} source bytes)`)
