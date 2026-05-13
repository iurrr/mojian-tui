# Publishing

## 准备

确认本地检查通过：

```bash
npm run ci
npm pack --dry-run
```

确认 npm 登录状态：

```bash
npm whoami
```

## 初始化 Git 仓库

当前目录如果还不是有效 Git 仓库，执行：

```bash
git init
git add README.md LICENSE CHANGELOG.md package.json .gitignore scripts src test docs .github
git commit -m "Initial release"
```

如果 `git status` 提示“不是 git 仓库”，但目录里已经存在 `.git`，先确认这个 `.git` 不是有效仓库或没有需要保留的历史，再将它移走或删除后重新执行 `git init`。

## 创建 GitHub 仓库

在 GitHub 创建一个空仓库，例如 `mojian-tui`，不要勾选自动生成 README、LICENSE 或 `.gitignore`，因为本项目已经包含这些文件。

然后关联并推送：

```bash
git branch -M main
git remote add origin https://github.com/iurrr/mojian-tui.git
git push -u origin main
```

## 发布到 npm

本项目的主发布渠道是 npm。发布前确认 `package.json` 中的 `version` 是目标版本，然后执行：

```bash
npm publish --access public
```

发布后用户可以安装：

```bash
npm install -g mojian-tui
```

## 创建 GitHub Release

推送后可以在 GitHub 页面进入 `Releases`，创建同版本 Release，例如 `v1.0.0`：

- Tag: `v1.0.0`
- Title: `墨笺 TUI 1.0.0`
- Notes: 可以复制 `CHANGELOG.md` 中的 `1.0.0` 内容

GitHub Release 用于版本说明和可选附件。`.deb`、裸二进制等平台相关构建产物不要提交到 Git 仓库；如果确实要提供，则作为 Release 附件上传。

## 平台安装包

`.deb`、`.rpm`、`.pkg`、`.exe` 等平台安装包需要分别构建和维护。除非有明确用户需求，否则优先维护 npm 发布流程。
