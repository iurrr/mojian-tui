# Publishing To GitHub

## 准备

确认本地检查通过：

```bash
npm run ci
npm pack --dry-run
```

## 初始化 Git 仓库

当前目录如果还不是有效 Git 仓库，执行：

```bash
git init
git add README.md LICENSE CHANGELOG.md package.json .gitignore src test docs .github
git commit -m "Initial release"
```

如果 `git status` 提示“不是 git 仓库”，但目录里已经存在 `.git`，先确认这个 `.git` 不是有效仓库或没有需要保留的历史，再将它移走或删除后重新执行 `git init`。

## 创建 GitHub 仓库

在 GitHub 创建一个空仓库，例如 `mojian-tui`，不要勾选自动生成 README、LICENSE 或 `.gitignore`，因为本项目已经包含这些文件。

然后关联并推送：

```bash
git branch -M main
git remote add origin https://github.com/<your-name>/mojian-tui.git
git push -u origin main
```

把 `<your-name>` 替换为你的 GitHub 用户名或组织名。

## 创建 Release

推送后可以在 GitHub 页面进入 `Releases`，创建 `v1.0.0`：

- Tag: `v1.0.0`
- Title: `墨笺 TUI 1.0.0`
- Notes: 可以复制 `CHANGELOG.md` 中的 `1.0.0` 内容

## 可选：发布到 npm

当前 `package.json` 里设置了 `"private": true`，用于避免误发布。将来如果要发布到 npm：

1. 删除 `"private": true`
2. 补充 `repository`、`bugs`、`homepage` 字段
3. 登录并发布：

```bash
npm login
npm publish
```
