# @tom2012/dsh-file-tree

DSH Web 右侧侧边栏的增强文件树。它注册与原生相同的 `files` 类型，但使用 `extension` 优先级，因此接管原生「文件」标签页；卸载后原生文件树自动恢复，不需要修改 DSH 源码。

[GitHub 仓库](https://github.com/zbc0315/dsh-file-tree) · [npm 包](https://www.npmjs.com/package/@tom2012/dsh-file-tree)

## 功能

- 工作区目录树：单层懒加载、展开/折叠、目录过滤、文件大小显示。
- 保留「新标签页 → 工作区文件」入口、原生刷新快捷键和文件资源预览。
- 上传单个/多个文件、整个文件夹，支持拖拽和上传进度，保留相对目录结构。
- 下载单文件（支持 HTTP Range）、文件夹 ZIP、多选 ZIP；ZIP 由宿主流式生成。
- 右键菜单：复制相对路径、复制绝对路径、复制文件名、`@ 到对话框`、下载/打包下载、上传到目录、新建、重命名、删除、编辑。
- 新建文件/文件夹、重命名、删除；删除默认移入 `~/.dsh-file-tree-trash/<时间戳>/`。
- 在线文本编辑与保存：限制文件大小、拒绝二进制、原子写入，使用 `mtimeMs + size` 检测外部修改冲突；支持 `Cmd/Ctrl+S`。

文件根始终是**当前会话的工作区**，不提供整块磁盘浏览。所有宿主请求都带 `sessionId`，服务端从该会话解析工作区。

## 安装

要求：DSH `>=0.2.1-rc.2`，Node.js `>=20`。

```bash
dsh plugin --profile web add @tom2012/dsh-file-tree
```

安装后重启 `dsh web` 并刷新页面。重启会中断当前 Web 会话，请在外部终端操作。然后在右侧边栏选择「新标签页 → 工作区文件」。

包已包含预构建的 `client/bundle.js`，安装时不依赖 `prepare` 或 `postinstall` 脚本。

## 本地开发

```bash
git clone https://github.com/zbc0315/dsh-file-tree.git
cd dsh-file-tree
npm install
npm run build

dsh plugin --profile web add "link:$(pwd)"
```

修改 `client/index.js` 后运行 `npm run build` 重新生成 `client/bundle.js`。客户端源码是自包含的 CommonJS，除了构建包装器注入的 React 外不使用 `import`。

## 校验

```bash
npm test           # 构建 + 语法检查 + 宿主测试 + 客户端冒烟测试
npm run selftest   # 真 HTTP + 真文件系统测试（61 项）
npm run smoke      # bundle 协议、注册载荷、真实 React 首屏渲染（34 项）
```

React 和 ReactDOM 仅作为开发依赖安装。也可以用 `FT_REACT_HOME=/path/to/node_modules npm run smoke` 借用已有的 React 安装。宿主自测使用 `python3`、`unzip`，并在 macOS 上用 `ditto` 验证 Finder 同款解包。

## 宿主路由

前缀：`/-/filetree`，同源、使用 DSH 现有认证与 `connection.requestRejection` 信任栅栏。

| 方法 | 路由 | 用途 |
| --- | --- | --- |
| GET | `/status?sessionId=...` | 检查会话与工作区 |
| GET | `/list?sessionId=...&path=...` | 列出单层目录 |
| GET | `/text?sessionId=...&path=...` | 读取可编辑文本 |
| POST | `/write?sessionId=...` | 保存文本（JSON：`path/text/expected`） |
| POST | `/create?sessionId=...` | 新建文件或目录 |
| POST | `/rename?sessionId=...` | 同目录重命名 |
| POST | `/delete?sessionId=...` | 删除（默认回收目录） |
| POST | `/upload?sessionId=...&path=...` | 原始字节流上传，`x-file-name` 或 `x-file-rel` 为 URI 编码的相对路径 |
| GET | `/download?sessionId=...&path=...` | 下载文件，支持 Range |
| GET | `/zip?sessionId=...&path=...` | 流式 ZIP；重复 `path` 可打包多选 |

默认限制：在线读取 2 MiB、单次保存 5 MiB、单文件上传 4 GiB；小文件 ZIP 内联阈值为 16 MiB。可在宿主插件配置中覆盖 `maxTextBytes`、`maxWriteBytes`、`maxUploadBytes`、`zipInlineLimit`、`trashDir`。

当前使用 ZIP32：压缩包接近 4 GiB 或达到 65534 个条目时会返回明确错误，请分批下载；暂不支持 ZIP64。

## 安全与兼容性

- 每个路径经过 `realpath` 与根目录约束，拒绝 `..` 越界和符号链接逃逸。
- 上传先写 `.part-*` 临时文件，完成后原子改名；文本保存先写临时文件再改名。
- 删除或重命名工作区根目录会被拒绝。
- 文件操作失败返回结构化 JSON 错误，不把异常直接抛给 Web 进程。
- 增强 entry 不重复声明、也不直接转发原生的 `sidebar.right.tab.files.actions` 插槽。该插槽属于原生 entry；重复声明会阻止原生插件激活，未声明就调用会触发 `SlotOwnershipError`。

## 卸载

```bash
dsh plugin --profile web remove @tom2012/dsh-file-tree
```

重启 `dsh web` 后，原生文件树恢复。回收目录中的已删除内容不会被卸载操作清理。

## License

[MIT](./LICENSE)
