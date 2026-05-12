import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Document, EditorState, WriterTui, displayWidth, fitText, parseArgs, wrapLineRanges } from "../src/main.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "mojian-test-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function testDocumentRoundTrip(): void {
  withTempDir((dir) => {
    const path = join(dir, "测试草稿.txt");
    const doc = new Document(path, "测试草稿", "第一行\n第二行");
    doc.save();

    const loaded = Document.load(path);
    assert(loaded.title === "测试草稿", "标题应能保存和读取");
    assert(loaded.content === "第一行\n第二行", "正文应能保存和读取");
    assert(readFileSync(path, "utf8") === "第一行\n第二行", "txt 文件内容应为纯正文");

    const markdown = loaded.exportMarkdown(dir);
    assert(readFileSync(markdown, "utf8") === "# 测试草稿\n\n第一行\n第二行\n", "Markdown 导出格式错误");
  });
}

function testCliArgParsing(): void {
  const version = parseArgs(["-v"]);
  assert(version.version === true, "-v 应解析为版本查询");
  assert(version.help === false, "-v 不应同时解析为帮助");

  const help = parseArgs(["--help"]);
  assert(help.help === true, "--help 应解析为帮助");

  const file = parseArgs(["./notes.txt"]);
  assert(file.filePath === "./notes.txt", "位置参数应解析为文件路径");

  const dir = parseArgs(["--dir", "./drafts"]);
  assert(dir.dir === "./drafts", "--dir 应解析草稿目录");

  const unknown = parseArgs(["--unknown"]);
  assert(Boolean(unknown.error), "未知参数应返回错误");
}

function testLegacyDocumentReadCompatibility(): void {
  withTempDir((dir) => {
    const path = join(dir, "legacy.mojian.json");
    const payload = { title: "旧草稿", content: "旧内容", updatedAt: 1 };
    writeFileSync(path, JSON.stringify(payload), "utf8");

    const loaded = Document.load(path);
    assert(loaded.title === "旧草稿", "旧 JSON 草稿标题读取失败");
    assert(loaded.content === "旧内容", "旧 JSON 草稿内容读取失败");
  });
}

function testOpenSpecificFileKeepsPathOnSave(): void {
  withTempDir((dir) => {
    const path = join(dir, "我的 笔记.md");
    writeFileSync(path, "旧内容", "utf8");

    const tui = new WriterTui({ filePath: path });
    tui.loadLibrary();

    assert(tui.doc.path === path, "指定文件路径应成为当前文档");
    assert(tui.doc.title === "我的 笔记", "指定文件标题应从文件名读取");
    assert(tui.editor.toText() === "旧内容", "指定文件内容应被读取");

    tui.editor.insertText("\n新内容");
    tui.markDirty();
    tui.saveToDirectory(dir, false);

    assert(tui.doc.path === path, "保存指定文件时不应自动改名");
    assert(readFileSync(path, "utf8") === "\n新内容旧内容", "指定文件应原路径保存");
  });
}

function testEditorInsertDeleteAndJoin(): void {
  const editor = EditorState.fromText("abc");
  editor.cursorX = 3;
  editor.newline();
  editor.insertChar("你");
  editor.insertChar("好");
  assert(editor.toText() === "abc\n你好", "插入和换行失败");

  editor.backspace();
  assert(editor.toText() === "abc\n你", "退格删除失败");

  editor.cursorX = 0;
  editor.backspace();
  assert(editor.toText() === "abc你", "跨行合并失败");
  assert(editor.cursorY === 0, "跨行合并后的行号错误");
  assert(editor.cursorX === 3, "跨行合并后的列号错误");
}

function testWideCharacterLayoutHelpers(): void {
  assert(displayWidth("ab你好") === 6, "中文显示宽度计算错误");
  assert(fitText("你好abc", 5) === "你好a", "宽字符截断错误");
  assert(JSON.stringify(wrapLineRanges("abcdef", 3)) === JSON.stringify([{ start: 0, end: 3 }, { start: 3, end: 6 }]), "ASCII 软换行分段错误");
  assert(JSON.stringify(wrapLineRanges("你好a", 4)) === JSON.stringify([{ start: 0, end: 2 }, { start: 2, end: 3 }]), "中文软换行分段错误");
}

function testSaveAndExportDirectories(): void {
  withTempDir((root) => {
    const source = join(root, "source");
    const target = join(root, "target");
    const exported = join(root, "exported");

    const tui = new WriterTui(source);
    tui.loadLibrary();
    tui.editor.insertText("可选择保存目录");
    tui.markDirty();
    tui.saveToDirectory(target, true);

    assert(tui.saveDir === target, "保存目录应更新到用户选择的目录");
    assert(tui.doc.path.startsWith(target), "草稿文件应写入用户选择的目录");
    assert(tui.doc.path.endsWith(".txt"), "新草稿应保存为 txt 文件");
    assert(!tui.doc.path.endsWith(".mojian.json"), "新草稿不应再使用 .mojian.json 后缀");
    assert(Document.load(tui.doc.path).content === "可选择保存目录", "选择目录后的保存内容错误");

    tui.exportMarkdown(exported);
    const markdown = readFileSync(join(exported, "未命名草稿.md"), "utf8");
    assert(markdown.includes("可选择保存目录"), "导出目录中的 Markdown 内容错误");
  });
}

function testRenameTitleUpdatesTxtFilename(): void {
  withTempDir((dir) => {
    const tui = new WriterTui(dir);
    tui.loadLibrary();
    const oldPath = tui.doc.path;

    tui.doc.title = "新的标题";
    tui.editor.insertText("标题同步到文件名");
    tui.markDirty();
    tui.saveToDirectory(dir, false);

    assert(tui.doc.path.endsWith("新的标题.txt"), "修改标题后 txt 文件名应同步更新");
    assert(!existsSync(oldPath), "修改标题后旧 txt 文件不应继续留在草稿列表");
    assert(Document.load(tui.doc.path).title === "新的标题", "从 txt 文件名恢复标题失败");
  });
}

function testSidebarSelectionOpensDocument(): void {
  withTempDir((dir) => {
    const first = new Document(join(dir, "测试1.txt"), "测试1", "内容1");
    const second = new Document(join(dir, "测试2.txt"), "测试2", "内容2");
    first.save();
    second.save();

    const tui = new WriterTui(dir);
    tui.loadLibrary();
    const targetIndex = tui.documents.findIndex((doc) => doc.title === "测试1");
    assert(targetIndex >= 0, "侧边栏测试草稿应存在");

    tui.sidebarIndex = targetIndex;
    tui.sidebarActive = true;
    tui.openSidebarSelection();

    assert(tui.doc.title === "测试1", "侧边栏应能打开选中的草稿");
    assert(tui.editor.toText() === "内容1", "侧边栏打开草稿后正文内容错误");
    assert(tui.sidebarActive === false, "打开草稿后应回到编辑区");
  });
}

function testRememberLastOpenedDocument(): void {
  withTempDir((dir) => {
    new Document(join(dir, "测试1.txt"), "测试1", "内容1").save();
    new Document(join(dir, "测试2.txt"), "测试2", "内容2").save();

    const firstRun = new WriterTui(dir);
    firstRun.loadLibrary();
    const index = firstRun.documents.findIndex((doc) => doc.title === "测试1");
    assert(index >= 0, "测试1 应存在");
    firstRun.openDocument(index);

    const secondRun = new WriterTui(dir);
    secondRun.loadLibrary();
    assert(secondRun.doc.title === "测试1", "应恢复上次打开的草稿");
    assert(secondRun.editor.toText() === "内容1", "恢复草稿正文错误");
  });
}

function testUndoRedo(): void {
  withTempDir((dir) => {
    const tui = new WriterTui(dir);
    tui.loadLibrary();
    const before = tui.snapshot();
    tui.editor.insertText("撤销测试");
    tui.pushUndo(before);
    tui.markDirty();

    tui.undo();
    assert(tui.editor.toText() === "", "撤销应恢复到编辑前");
    tui.redo();
    assert(tui.editor.toText() === "撤销测试", "重做应恢复撤销前内容");
  });
}

function testVisualWrapRows(): void {
  withTempDir((dir) => {
    const tui = new WriterTui(dir);
    tui.loadLibrary();
    tui.editor = EditorState.fromText("abcdef");
    const rows = tui.visualLines(8);
    assert(rows.length === 2, "编辑区宽度为 8 时正文宽度为 3，应显示为两行");
    assert(rows[0].start === 0 && rows[0].end === 3, "第一条视觉行分段错误");
    assert(rows[1].start === 3 && rows[1].end === 6, "第二条视觉行分段错误");
  });
}

function testCountsForBottomLeftStats(): void {
  withTempDir((dir) => {
    const tui = new WriterTui(dir);
    tui.loadLibrary();
    tui.editor = EditorState.fromText("你好 world\n第二段");
    const counts = tui.counts();
    assert(counts.chars === 10, "字数统计应排除空白并包含中英文字符");
    assert(counts.words === 6, "词数统计错误");
  });
}

function testLastSaveTimeDisplayUpdatesAfterSave(): void {
  withTempDir((dir) => {
    const tui = new WriterTui(dir);
    tui.loadLibrary();
    tui.lastSave = 0;
    assert(tui.lastSaveText() === "未保存", "未保存状态显示错误");

    tui.editor.insertText("保存时间");
    tui.markDirty();
    tui.saveToDirectory(dir, false);

    assert(tui.lastSave > 0, "保存后应更新 lastSave");
    assert(tui.lastSaveText() !== "未保存", "保存后应显示具体时间");
  });
}

testDocumentRoundTrip();
testCliArgParsing();
testLegacyDocumentReadCompatibility();
testOpenSpecificFileKeepsPathOnSave();
testEditorInsertDeleteAndJoin();
testWideCharacterLayoutHelpers();
testSaveAndExportDirectories();
testRenameTitleUpdatesTxtFilename();
testSidebarSelectionOpensDocument();
testRememberLastOpenedDocument();
testUndoRedo();
testVisualWrapRows();
testCountsForBottomLeftStats();
testLastSaveTimeDisplayUpdatesAfterSave();
console.log("writer_tui TypeScript core tests passed");
