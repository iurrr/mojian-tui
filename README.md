# 墨笺 TUI

一个零依赖的终端文字创作软件，使用 TypeScript 和 Node.js 的原生终端能力实现。

## 环境要求

- Node.js `>=24`

## 运行

```bash
npm start
```

也可以指定草稿库目录：

```bash
npm start -- --dir ./drafts
```

也可以直接运行入口：

```bash
node src/main.ts
```

## 功能

- TUI 双栏界面：左侧写作编辑区，右侧草稿列表
- 草稿默认保存在当前工作目录
- `Ctrl+S` 保存时可选择保存目录
- `Ctrl+E` 导出时可选择导出目录
- 自动保存、手动保存和退出前保存
- 启动时自动恢复上次打开的草稿
- 新建草稿、切换草稿、修改标题
- 可进入右侧草稿栏，用方向键选择并打开草稿
- 长行按窗口宽度自动软换行显示
- 支持撤销和重做
- 搜索正文、导出 Markdown
- 屏幕左下角固定显示当前字数和上次保存时间，底栏显示词数、段落数和光标位置
- 专注模式，可隐藏草稿栏

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+S` | 保存，并可输入保存目录 |
| `Ctrl+Q` | 保存并退出 |
| `Ctrl+N` | 新建草稿 |
| `Ctrl+O` | 切换到下一篇草稿 |
| `Ctrl+P` | 切换到上一篇草稿 |
| `Ctrl+B` | 进入或退出右侧草稿栏 |
| `Ctrl+Z` | 撤销 |
| `Ctrl+Y` | 重做 |
| `Ctrl+T` | 修改标题 |
| `Ctrl+F` | 搜索 |
| `Ctrl+E` | 导出 Markdown，并可输入导出目录 |
| `Ctrl+L` | 切换专注模式 |
| `Ctrl+H` | 帮助 |
| `Backspace` | 删除前一个字符 |
| `Delete` | 删除后一个字符 |

右侧草稿栏激活后，可用 `Up/Down` 选择草稿，`Enter` 打开草稿，`Esc` 返回编辑区。

草稿默认保存在运行命令时所在的当前工作目录，格式为 `.txt`；导出时默认使用当前工作目录，并生成 `.md` 文件。

## 测试

```bash
npm test
```

完整检查：

```bash
npm run ci
```

## 项目结构

```text
src/main.ts              # TUI 主程序
test/writer_tui.test.ts  # 核心逻辑测试
README.md                # 使用说明
CHANGELOG.md             # 版本记录
LICENSE                  # MIT 许可证
docs/PUBLISHING.md       # GitHub 发布步骤
```

## 发布

发布到 GitHub 的步骤见 [docs/PUBLISHING.md](docs/PUBLISHING.md)。
