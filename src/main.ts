#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as readline from "node:readline";

export const APP_NAME = "墨笺 TUI";
export const DRAFT_SUFFIX = ".txt";
const LEGACY_DRAFT_SUFFIX = ".mojian.json";
const STATE_FILE = ".mojian-state.json";
const AUTOSAVE_SECONDS = 20;
const MAX_HISTORY = 200;
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const FG_CYAN = "\x1b[36m";
const FG_YELLOW = "\x1b[33m";
const FG_BLACK = "\x1b[30m";
const FG_WHITE = "\x1b[37m";
const BG_CYAN = "\x1b[46m";
const BG_BLUE = "\x1b[44m";
const REVERSE = "\x1b[7m";

type Key = {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
};

type PromptState = {
  label: string;
  value: string;
  cursor: number;
  onSubmit: (value: string) => void;
  onCancel?: () => void;
};

type EditorSnapshot = {
  text: string;
  cursorY: number;
  cursorX: number;
};

type VisualLine = {
  lineIndex: number;
  start: number;
  end: number;
};

export function charLength(text: string): number {
  return Array.from(text).length;
}

export function sliceChars(text: string, start = 0, end?: number): string {
  return Array.from(text).slice(start, end).join("");
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of Array.from(text)) {
    width += char.charCodeAt(0) < 128 ? 1 : 2;
  }
  return width;
}

export function fitText(text: string, width: number): string {
  if (width <= 0) {
    return "";
  }
  let result = "";
  let used = 0;
  for (const char of Array.from(text)) {
    const charWidth = char.charCodeAt(0) < 128 ? 1 : 2;
    if (used + charWidth > width) {
      break;
    }
    result += char;
    used += charWidth;
  }
  return result + " ".repeat(Math.max(0, width - used));
}

export function wrapLineRanges(line: string, width: number): Array<{ start: number; end: number }> {
  const textWidth = Math.max(1, width);
  const chars = Array.from(line);
  if (chars.length === 0) {
    return [{ start: 0, end: 0 }];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let start = 0;
  let used = 0;
  for (let index = 0; index < chars.length; index += 1) {
    const charWidth = chars[index].charCodeAt(0) < 128 ? 1 : 2;
    if (used > 0 && used + charWidth > textWidth) {
      ranges.push({ start, end: index });
      start = index;
      used = 0;
    }
    used += charWidth;
  }
  ranges.push({ start, end: chars.length });
  return ranges;
}

export function slugify(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  const slug = normalized.replace(/[^a-z0-9\-\u4e00-\u9fff]+/g, "").slice(0, 48);
  return slug || "untitled";
}

function nowSeconds(): number {
  return Date.now() / 1000;
}

function expandUserPath(path: string): string {
  if (path === "~") {
    return process.env.HOME || process.cwd();
  }
  if (path.startsWith("~/")) {
    return join(process.env.HOME || process.cwd(), path.slice(2));
  }
  return path;
}

function resolveDirectory(input: string, fallback: string): string {
  const raw = input.trim() || fallback;
  return resolve(expandUserPath(raw));
}

function move(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

function lineClear(): string {
  return "\x1b[2K";
}

function uniqueDraftPath(directory: string, title: string, currentPath?: string): string {
  const slug = slugify(title);
  let candidate = join(directory, `${slug}${DRAFT_SUFFIX}`);
  if (currentPath && resolve(candidate) === resolve(currentPath)) {
    return candidate;
  }
  let counter = 2;
  while (existsSync(candidate)) {
    candidate = join(directory, `${slug}-${counter}${DRAFT_SUFFIX}`);
    if (currentPath && resolve(candidate) === resolve(currentPath)) {
      return candidate;
    }
    counter += 1;
  }
  return candidate;
}

function titleFromPath(path: string): string {
  const file = basename(path);
  if (file.endsWith(LEGACY_DRAFT_SUFFIX)) {
    return file.slice(0, -LEGACY_DRAFT_SUFFIX.length).replace(/-/g, " ");
  }
  return basename(path, extname(path)).replace(/-/g, " ");
}

function markdownPath(directory: string, title: string): string {
  return join(directory, `${slugify(title)}.md`);
}

export class Document {
  path: string;
  title: string;
  content: string;
  updatedAt: number;

  constructor(path: string, title: string, content = "", updatedAt = nowSeconds()) {
    this.path = path;
    this.title = title;
    this.content = content;
    this.updatedAt = updatedAt;
  }

  static load(path: string): Document {
    if (!existsSync(path)) {
      const fileName = titleFromPath(path);
      return new Document(path, fileName || "未命名");
    }
    const raw = readFileSync(path, "utf8");
    const fallbackTitle = titleFromPath(path);
    if (!path.endsWith(LEGACY_DRAFT_SUFFIX)) {
      return new Document(path, fallbackTitle || "未命名", raw, statSync(path).mtimeMs / 1000);
    }
    const data = JSON.parse(raw) as { title?: string; content?: string; updatedAt?: number; updated_at?: number };
    return new Document(
      path,
      data.title || fallbackTitle || "未命名",
      data.content || "",
      Number(data.updatedAt ?? data.updated_at ?? statSync(path).mtimeMs / 1000),
    );
  }

  save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    this.updatedAt = nowSeconds();
    writeFileSync(this.path, this.content, "utf8");
  }

  exportMarkdown(directory: string): string {
    mkdirSync(directory, { recursive: true });
    const target = markdownPath(directory, this.title);
    const body = this.content.trimEnd();
    writeFileSync(target, `# ${this.title}\n\n${body}\n`, "utf8");
    return target;
  }
}

export class EditorState {
  lines: string[];
  cursorY = 0;
  cursorX = 0;
  topLine = 0;
  leftCol = 0;

  constructor(lines = [""]) {
    this.lines = lines.length > 0 ? lines : [""];
  }

  static fromText(text: string): EditorState {
    return new EditorState(text.split("\n"));
  }

  toText(): string {
    return this.lines.join("\n");
  }

  clampCursor(): void {
    this.cursorY = Math.max(0, Math.min(this.cursorY, this.lines.length - 1));
    this.cursorX = Math.max(0, Math.min(this.cursorX, charLength(this.lines[this.cursorY])));
  }

  insertText(text: string): void {
    for (const char of Array.from(text)) {
      if (char === "\r") {
        continue;
      }
      if (char === "\n") {
        this.newline();
      } else {
        this.insertChar(char);
      }
    }
  }

  insertChar(char: string): void {
    const line = this.lines[this.cursorY];
    this.lines[this.cursorY] = sliceChars(line, 0, this.cursorX) + char + sliceChars(line, this.cursorX);
    this.cursorX += charLength(char);
  }

  newline(): void {
    const line = this.lines[this.cursorY];
    this.lines[this.cursorY] = sliceChars(line, 0, this.cursorX);
    this.lines.splice(this.cursorY + 1, 0, sliceChars(line, this.cursorX));
    this.cursorY += 1;
    this.cursorX = 0;
  }

  backspace(): void {
    if (this.cursorX > 0) {
      const line = this.lines[this.cursorY];
      this.lines[this.cursorY] = sliceChars(line, 0, this.cursorX - 1) + sliceChars(line, this.cursorX);
      this.cursorX -= 1;
      return;
    }
    if (this.cursorY > 0) {
      const previousLength = charLength(this.lines[this.cursorY - 1]);
      this.lines[this.cursorY - 1] += this.lines.splice(this.cursorY, 1)[0];
      this.cursorY -= 1;
      this.cursorX = previousLength;
    }
  }

  deleteForward(): void {
    const line = this.lines[this.cursorY];
    if (this.cursorX < charLength(line)) {
      this.lines[this.cursorY] = sliceChars(line, 0, this.cursorX) + sliceChars(line, this.cursorX + 1);
      return;
    }
    if (this.cursorY < this.lines.length - 1) {
      this.lines[this.cursorY] += this.lines.splice(this.cursorY + 1, 1)[0];
    }
  }

  moveLeft(): void {
    if (this.cursorX > 0) {
      this.cursorX -= 1;
    } else if (this.cursorY > 0) {
      this.cursorY -= 1;
      this.cursorX = charLength(this.lines[this.cursorY]);
    }
  }

  moveRight(): void {
    if (this.cursorX < charLength(this.lines[this.cursorY])) {
      this.cursorX += 1;
    } else if (this.cursorY < this.lines.length - 1) {
      this.cursorY += 1;
      this.cursorX = 0;
    }
  }

  moveUp(): void {
    if (this.cursorY > 0) {
      this.cursorY -= 1;
      this.clampCursor();
    }
  }

  moveDown(): void {
    if (this.cursorY < this.lines.length - 1) {
      this.cursorY += 1;
      this.clampCursor();
    }
  }
}

export class WriterTui {
  library: string;
  saveDir: string;
  exportDir: string;
  documents: Document[] = [];
  currentIndex = 0;
  doc: Document = new Document(join(process.cwd(), `untitled${DRAFT_SUFFIX}`), "未命名草稿");
  editor = new EditorState();
  status = "Ctrl+H 查看帮助";
  dirty = false;
  focusMode = false;
  sidebarActive = false;
  sidebarIndex = 0;
  sidebarTop = 0;
  undoStack: EditorSnapshot[] = [];
  redoStack: EditorSnapshot[] = [];
  running = false;
  lastSave = nowSeconds();
  helpVisible = false;
  promptState: PromptState | null = null;
  autosaveTimer: ReturnType<typeof setInterval> | null = null;
  keyHandler: ((str: string, key: Key) => void) | null = null;

  constructor(library = process.cwd()) {
    this.library = resolveDirectory(library, process.cwd());
    this.saveDir = this.library;
    this.exportDir = process.cwd();
  }

  run(): void {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      console.error(`${APP_NAME} 需要在交互式终端中运行。`);
      process.exitCode = 1;
      return;
    }

    this.running = true;
    this.loadLibrary();
    this.enterScreen();
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    this.keyHandler = (str: string, key: Key) => this.handleKey(str, key);
    process.stdin.on("keypress", this.keyHandler);
    process.stdout.on("resize", () => this.draw());
    process.on("SIGINT", () => this.quit());
    this.autosaveTimer = setInterval(() => this.autosaveIfNeeded(), 500);
    this.draw();
  }

  enterScreen(): void {
    process.stdout.write("\x1b[?1049h\x1b[?25h\x1b[H\x1b[2J");
  }

  leaveScreen(): void {
    process.stdout.write("\x1b[?25h\x1b[?1049l");
  }

  statePath(directory = this.library): string {
    return join(directory, STATE_FILE);
  }

  readLastOpened(directory = this.library): string | null {
    const path = this.statePath(directory);
    if (!existsSync(path)) {
      return null;
    }
    try {
      const data = JSON.parse(readFileSync(path, "utf8")) as { lastOpened?: string };
      return data.lastOpened || null;
    } catch {
      return null;
    }
  }

  saveState(directory = this.library): void {
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        this.statePath(directory),
        JSON.stringify({ lastOpened: this.doc.path, updatedAt: nowSeconds() }, null, 2),
        "utf8",
      );
    } catch {
      // 状态文件只是体验增强，失败时不阻塞写作和保存。
    }
  }

  loadLibrary(): void {
    mkdirSync(this.library, { recursive: true });
    const files = readdirSync(this.library)
      .filter((file) => file.endsWith(DRAFT_SUFFIX) || file.endsWith(LEGACY_DRAFT_SUFFIX))
      .map((file) => join(this.library, file))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
    this.documents = files.map((path) => Document.load(path));
    if (this.documents.length === 0) {
      const first = new Document(uniqueDraftPath(this.library, "未命名草稿"), "未命名草稿");
      first.save();
      this.documents = [first];
    }
    const lastOpened = this.readLastOpened();
    const lastIndex = lastOpened ? this.documents.findIndex((item) => resolve(item.path) === resolve(lastOpened)) : -1;
    this.openDocument(lastIndex >= 0 ? lastIndex : 0);
    this.sidebarIndex = this.currentIndex;
    this.sidebarTop = 0;
  }

  refreshLibraryKeeping(path: string): void {
    const files = readdirSync(this.library)
      .filter((file) => file.endsWith(DRAFT_SUFFIX) || file.endsWith(LEGACY_DRAFT_SUFFIX))
      .map((file) => join(this.library, file))
      .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
    this.documents = files.map((item) => Document.load(item));
    const index = this.documents.findIndex((item) => item.path === path);
    this.currentIndex = Math.max(0, index);
    this.sidebarIndex = this.currentIndex;
    this.ensureSidebarVisible();
    this.doc = this.documents[this.currentIndex];
    this.saveState();
  }

  openDocument(index: number): void {
    this.currentIndex = Math.max(0, Math.min(index, this.documents.length - 1));
    this.sidebarIndex = this.currentIndex;
    this.ensureSidebarVisible();
    this.doc = Document.load(this.documents[this.currentIndex].path);
    this.documents[this.currentIndex] = this.doc;
    this.editor = EditorState.fromText(this.doc.content);
    this.resetHistory();
    this.lastSave = this.doc.updatedAt || nowSeconds();
    this.dirty = false;
    this.status = `已打开：${this.doc.title}`;
    this.saveState();
  }

  snapshot(): EditorSnapshot {
    return {
      text: this.editor.toText(),
      cursorY: this.editor.cursorY,
      cursorX: this.editor.cursorX,
    };
  }

  restoreSnapshot(snapshot: EditorSnapshot): void {
    this.editor = EditorState.fromText(snapshot.text);
    this.editor.cursorY = snapshot.cursorY;
    this.editor.cursorX = snapshot.cursorX;
    this.editor.clampCursor();
    this.doc.content = this.editor.toText();
    this.dirty = true;
  }

  resetHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  pushUndo(snapshot: EditorSnapshot): void {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(): void {
    if (this.undoStack.length === 0) {
      this.status = "没有可撤销的操作";
      return;
    }
    this.redoStack.push(this.snapshot());
    const snapshot = this.undoStack.pop();
    if (snapshot) {
      this.restoreSnapshot(snapshot);
      this.status = "已撤销";
    }
  }

  redo(): void {
    if (this.redoStack.length === 0) {
      this.status = "没有可重做的操作";
      return;
    }
    this.undoStack.push(this.snapshot());
    const snapshot = this.redoStack.pop();
    if (snapshot) {
      this.restoreSnapshot(snapshot);
      this.status = "已重做";
    }
  }

  draw(): void {
    const height = process.stdout.rows || 24;
    const width = process.stdout.columns || 80;
    let out = "\x1b[?25l";

    for (let row = 1; row <= height; row += 1) {
      out += move(row, 1) + lineClear();
    }

    if (height < 10 || width < 50) {
      out += move(1, 1) + "终端窗口太小，请调大到至少 50x10。";
      process.stdout.write(out + "\x1b[?25h");
      return;
    }

    const sidebarWidth = this.focusMode ? 0 : Math.min(30, Math.max(22, Math.floor(width / 4)));
    const editorX = 1;
    const editorWidth = this.focusMode ? width : width - sidebarWidth - 1;
    const separatorX = editorWidth + 1;
    const sidebarX = separatorX + 1;

    out += this.drawHeader(editorX, editorWidth);
    out += this.drawEditor(3, editorX, height - 5, editorWidth);
    out += this.drawFooter(height - 1, editorX, editorWidth);

    if (!this.focusMode) {
      for (let row = 1; row <= height; row += 1) {
        out += move(row, separatorX) + FG_CYAN + "│" + RESET;
      }
      out += this.drawSidebar(height, sidebarWidth, sidebarX);
    }

    out += this.drawStatus(height, width);

    if (this.helpVisible) {
      out += this.drawHelp(height, width);
    }
    if (this.promptState) {
      out += this.drawPrompt(height, width);
    }

    out += this.cursorSequence(3, editorX, height - 5, editorWidth);
    const showCursor = Boolean(this.promptState) || (!this.helpVisible && !this.sidebarActive);
    process.stdout.write(out + (showCursor ? "\x1b[?25h" : "\x1b[?25l"));
  }

  drawSidebar(height: number, width: number, x: number): string {
    const title = this.sidebarActive ? " 草稿 [操作]" : " 草稿";
    let out = move(1, x) + BOLD + FG_BLACK + BG_CYAN + fitText(title, width) + RESET;
    const maxItems = height - 3;
    this.ensureSidebarVisible(maxItems);
    for (let offset = 0; offset < maxItems; offset += 1) {
      const index = this.sidebarTop + offset;
      if (index >= this.documents.length) {
        out += move(offset + 2, x) + fitText("", width);
        continue;
      }
      const doc = this.documents[index];
      const selectMarker = index === this.sidebarIndex ? ">" : " ";
      const openMarker = index === this.currentIndex ? "*" : " ";
      const text = fitText(`${selectMarker}${openMarker} ${doc.title}`, width);
      const style = index === this.sidebarIndex ? REVERSE : index === this.currentIndex ? BOLD : "";
      out += move(offset + 2, x) + style + text + RESET;
    }
    const hint = this.sidebarActive ? " Up/Down  Enter  Esc" : " Ctrl+B 操作侧栏";
    out += move(height - 1, x) + FG_CYAN + fitText(hint, width) + RESET;
    return out;
  }

  drawHeader(x: number, width: number): string {
    const dirty = this.dirty ? "*" : "";
    const title = ` ${this.doc.title}${dirty}`;
    const hint = " Ctrl+S 保存/选目录  Ctrl+B 侧栏  Ctrl+H 帮助  Ctrl+Q 退出 ";
    return (
      move(1, x) +
      BOLD +
      FG_BLACK +
      BG_CYAN +
      fitText(title, width) +
      RESET +
      move(2, x) +
      FG_CYAN +
      fitText(hint, width) +
      RESET
    );
  }

  drawEditor(y: number, x: number, height: number, width: number): string {
    const rows = this.visualLines(width);
    this.ensureCursorVisible(height, width, rows);
    let out = "";
    for (let screenRow = 0; screenRow < height; screenRow += 1) {
      const visualIndex = this.editor.topLine + screenRow;
      const row = y + screenRow;
      if (visualIndex >= rows.length) {
        out += move(row, x) + fitText("", width);
        continue;
      }
      const visual = rows[visualIndex];
      const lineNo = visual.start === 0 ? `${String(visual.lineIndex + 1).padStart(4, " ")} ` : "     ";
      const visible = sliceChars(this.editor.lines[visual.lineIndex], visual.start, visual.end);
      out += move(row, x) + FG_CYAN + lineNo + RESET + fitText(visible, width - lineNo.length);
    }
    return out;
  }

  drawFooter(y: number, x: number, width: number): string {
    const counts = this.counts();
    const position = ` 行 ${this.editor.cursorY + 1}/${this.editor.lines.length}  列 ${this.editor.cursorX + 1}`;
    const dirs = ` 保存目录 ${this.saveDir}`;
    const mode = this.sidebarActive ? "  模式 侧栏" : "  模式 编辑";
    const saved = ` 上次保存 ${this.lastSaveText()}`;
    const text = ` 字数 ${counts.chars}  词 ${counts.words}  段落 ${counts.paragraphs}${position}${saved}${mode}${dirs}`;
    return move(y, x) + FG_YELLOW + fitText(text, width) + RESET;
  }

  drawStatus(y: number, width: number): string {
    const counts = this.counts();
    return move(y, 1) + FG_WHITE + BG_BLUE + fitText(` 字数 ${counts.chars} | 上次保存 ${this.lastSaveText()} | ${this.status}`, width) + RESET;
  }

  lastSaveText(): string {
    if (!Number.isFinite(this.lastSave) || this.lastSave <= 0) {
      return "未保存";
    }
    return new Date(this.lastSave * 1000).toLocaleTimeString();
  }

  drawHelp(height: number, width: number): string {
    const boxHeight = Math.min(20, height - 2);
    const boxWidth = Math.min(76, width - 4);
    const top = Math.floor((height - boxHeight) / 2) + 1;
    const left = Math.floor((width - boxWidth) / 2) + 1;
    const lines = [
      `${APP_NAME} 快捷键`,
      "",
      "Ctrl+S 保存，并可输入保存目录",
      "Ctrl+Q 保存并退出",
      "Ctrl+N 新建草稿    Ctrl+O 下一篇    Ctrl+P 上一篇",
      "Ctrl+T 修改标题    Ctrl+F 搜索",
      "Ctrl+E 导出 Markdown，并可输入导出目录",
      "Ctrl+Z 撤销        Ctrl+Y 重做",
      "Ctrl+B 操作侧边栏  Ctrl+L 专注模式  Ctrl+H 帮助",
      "侧栏中 Up/Down 选择，Enter 打开，Esc 返回编辑区",
      "长行会按窗口宽度自动软换行显示",
      "Backspace 删除前一个字符，Delete 删除后一个字符",
      "",
      `当前保存目录：${this.saveDir}`,
      `默认目录：${process.cwd()}`,
      "",
      "按任意键返回。",
    ];
    return this.drawBox(top, left, boxHeight, boxWidth, lines);
  }

  drawPrompt(height: number, width: number): string {
    if (!this.promptState) {
      return "";
    }
    const boxWidth = Math.min(Math.max(58, displayWidth(this.promptState.label) + displayWidth(this.promptState.value) + 10), width - 4);
    const boxHeight = 6;
    const top = Math.floor((height - boxHeight) / 2) + 1;
    const left = Math.floor((width - boxWidth) / 2) + 1;
    const textWidth = boxWidth - 4;
    const start = this.promptVisibleStart(textWidth);
    const visible = sliceChars(this.promptState.value, start);
    const beforeCursor = sliceChars(this.promptState.value, start, this.promptState.cursor);
    let out = this.drawBox(top, left, boxHeight, boxWidth, [
      this.promptState.label,
      visible,
      "Enter 确认，Esc 取消。路径为空时使用默认目录。",
    ]);
    out += move(top + 2, left + 2 + displayWidth(beforeCursor));
    return out;
  }

  drawBox(top: number, left: number, height: number, width: number, lines: string[]): string {
    let out = "";
    const horizontal = "-".repeat(width - 2);
    out += move(top, left) + "+" + horizontal + "+";
    for (let row = 1; row < height - 1; row += 1) {
      const line = lines[row - 1] || "";
      out += move(top + row, left) + "|" + fitText(` ${line}`, width - 2) + "|";
    }
    out += move(top + height - 1, left) + "+" + horizontal + "+";
    return out;
  }

  cursorSequence(y: number, x: number, height: number, width: number): string {
    if (this.helpVisible) {
      return "";
    }
    if (this.promptState) {
      return "";
    }
    const rows = this.visualLines(width);
    const visualIndex = this.cursorVisualIndex(rows);
    const visual = rows[visualIndex];
    if (!visual) {
      return "";
    }
    const row = y + visualIndex - this.editor.topLine;
    const line = this.editor.lines[this.editor.cursorY];
    const beforeCursor = sliceChars(line, visual.start, this.editor.cursorX);
    const col = Math.min(x + width - 1, x + 5 + displayWidth(beforeCursor));
    if (row >= y && row < y + height && col >= x && col < x + width) {
      return move(row, col);
    }
    return "";
  }

  visualLines(width: number): VisualLine[] {
    const textWidth = Math.max(1, width - 5);
    const rows: VisualLine[] = [];
    for (let lineIndex = 0; lineIndex < this.editor.lines.length; lineIndex += 1) {
      for (const range of wrapLineRanges(this.editor.lines[lineIndex], textWidth)) {
        rows.push({ lineIndex, start: range.start, end: range.end });
      }
    }
    return rows.length > 0 ? rows : [{ lineIndex: 0, start: 0, end: 0 }];
  }

  cursorVisualIndex(rows: VisualLine[]): number {
    const line = this.editor.lines[this.editor.cursorY] || "";
    const lineLength = charLength(line);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (row.lineIndex !== this.editor.cursorY) {
        continue;
      }
      if (lineLength === 0 && this.editor.cursorX === 0) {
        return index;
      }
      if (this.editor.cursorX >= row.start && this.editor.cursorX < row.end) {
        return index;
      }
      if (this.editor.cursorX === lineLength && this.editor.cursorX >= row.start && this.editor.cursorX <= row.end) {
        return index;
      }
    }
    return 0;
  }

  ensureCursorVisible(height: number, width: number, rows = this.visualLines(width)): void {
    this.editor.leftCol = 0;
    const visualIndex = this.cursorVisualIndex(rows);
    if (visualIndex < this.editor.topLine) {
      this.editor.topLine = visualIndex;
    } else if (visualIndex >= this.editor.topLine + height) {
      this.editor.topLine = visualIndex - height + 1;
    }
    this.editor.topLine = Math.max(0, Math.min(this.editor.topLine, Math.max(0, rows.length - height)));
  }

  currentEditorWidth(): number {
    const width = process.stdout.columns || 80;
    if (this.focusMode) {
      return width;
    }
    const sidebarWidth = Math.min(30, Math.max(22, Math.floor(width / 4)));
    return width - sidebarWidth - 1;
  }

  charIndexAtDisplayColumn(line: string, start: number, end: number, column: number): number {
    let used = 0;
    for (let index = start; index < end; index += 1) {
      const char = sliceChars(line, index, index + 1);
      const charWidth = char.charCodeAt(0) < 128 ? 1 : 2;
      if (used + charWidth > column) {
        return index;
      }
      used += charWidth;
    }
    return end;
  }

  moveVisual(delta: number): void {
    const width = this.currentEditorWidth();
    const rows = this.visualLines(width);
    const currentIndex = this.cursorVisualIndex(rows);
    const currentRow = rows[currentIndex];
    const currentLine = this.editor.lines[this.editor.cursorY] || "";
    const targetColumn = currentRow ? displayWidth(sliceChars(currentLine, currentRow.start, this.editor.cursorX)) : 0;
    const targetIndex = Math.max(0, Math.min(currentIndex + delta, rows.length - 1));
    const target = rows[targetIndex];
    const targetLine = this.editor.lines[target.lineIndex] || "";
    this.editor.cursorY = target.lineIndex;
    this.editor.cursorX = this.charIndexAtDisplayColumn(targetLine, target.start, target.end, targetColumn);
    this.editor.clampCursor();
  }

  promptVisibleStart(width: number): number {
    if (!this.promptState) {
      return 0;
    }
    let start = 0;
    while (displayWidth(sliceChars(this.promptState.value, start, this.promptState.cursor)) >= width) {
      start += 1;
    }
    return start;
  }

  ensureSidebarVisible(maxVisible = Math.max(1, (process.stdout.rows || 24) - 3)): void {
    if (this.documents.length === 0) {
      this.sidebarIndex = 0;
      this.sidebarTop = 0;
      return;
    }
    this.sidebarIndex = Math.max(0, Math.min(this.sidebarIndex, this.documents.length - 1));
    if (this.sidebarIndex < this.sidebarTop) {
      this.sidebarTop = this.sidebarIndex;
    } else if (this.sidebarIndex >= this.sidebarTop + maxVisible) {
      this.sidebarTop = this.sidebarIndex - maxVisible + 1;
    }
    this.sidebarTop = Math.max(0, Math.min(this.sidebarTop, Math.max(0, this.documents.length - maxVisible)));
  }

  toggleSidebarFocus(): void {
    if (this.focusMode) {
      this.focusMode = false;
    }
    this.sidebarActive = !this.sidebarActive;
    if (this.sidebarActive) {
      this.sidebarIndex = this.currentIndex;
      this.ensureSidebarVisible();
      this.status = "侧边栏已激活：Up/Down 选择，Enter 打开，Esc 返回编辑区";
    } else {
      this.status = "已返回编辑区";
    }
  }

  sidebarMove(delta: number): void {
    if (this.documents.length === 0) {
      return;
    }
    this.sidebarIndex = Math.max(0, Math.min(this.sidebarIndex + delta, this.documents.length - 1));
    this.ensureSidebarVisible();
    this.status = `已选择：${this.documents[this.sidebarIndex].title}`;
  }

  openSidebarSelection(): void {
    if (this.documents.length === 0) {
      return;
    }
    if (this.dirty) {
      this.saveToDirectory(this.saveDir, false);
    }
    this.openDocument(this.sidebarIndex);
    this.sidebarActive = false;
    this.status = `已从侧边栏打开：${this.doc.title}`;
  }

  handleSidebarKey(key: Key): void {
    const pageSize = Math.max(1, (process.stdout.rows || 24) - 4);
    if (key.name === "escape" || key.name === "left") {
      this.sidebarActive = false;
      this.status = "已返回编辑区";
    } else if (key.name === "up") {
      this.sidebarMove(-1);
    } else if (key.name === "down") {
      this.sidebarMove(1);
    } else if (key.name === "pageup") {
      this.sidebarMove(-pageSize);
    } else if (key.name === "pagedown") {
      this.sidebarMove(pageSize);
    } else if (key.name === "home") {
      this.sidebarIndex = 0;
      this.ensureSidebarVisible();
      this.status = `已选择：${this.documents[this.sidebarIndex].title}`;
    } else if (key.name === "end") {
      this.sidebarIndex = Math.max(0, this.documents.length - 1);
      this.ensureSidebarVisible();
      this.status = `已选择：${this.documents[this.sidebarIndex].title}`;
    } else if (key.name === "return" || key.name === "enter" || key.name === "right") {
      this.openSidebarSelection();
    }
    this.draw();
  }

  handleKey(str: string, key: Key): void {
    if (this.helpVisible) {
      this.helpVisible = false;
      this.status = "Ctrl+H 查看帮助";
      this.draw();
      return;
    }
    if (this.promptState) {
      this.handlePromptKey(str, key);
      return;
    }

    if ((key.ctrl && key.name === "c") || (key.ctrl && key.name === "q")) {
      this.quit();
      return;
    }
    if ((key.ctrl && key.name === "s") || key.sequence === "\x13") {
      this.promptSaveDirectory();
      return;
    }
    if ((key.ctrl && key.name === "n") || key.sequence === "\x0e") {
      this.promptNewDocument();
      return;
    }
    if ((key.ctrl && key.name === "o") || key.sequence === "\x0f") {
      this.nextDocument();
      return;
    }
    if ((key.ctrl && key.name === "p") || key.sequence === "\x10") {
      this.previousDocument();
      return;
    }
    if ((key.ctrl && key.name === "t") || key.sequence === "\x14") {
      this.promptRename();
      return;
    }
    if ((key.ctrl && key.name === "f") || key.sequence === "\x06") {
      this.promptSearch();
      return;
    }
    if ((key.ctrl && key.name === "e") || key.sequence === "\x05") {
      this.promptExportDirectory();
      return;
    }
    if ((key.ctrl && key.name === "b") || key.sequence === "\x02") {
      this.toggleSidebarFocus();
      this.draw();
      return;
    }
    if ((key.ctrl && key.name === "l") || key.sequence === "\x0c") {
      this.focusMode = !this.focusMode;
      if (this.focusMode) {
        this.sidebarActive = false;
      }
      this.status = this.focusMode ? "专注模式已开启" : "专注模式已关闭";
      this.draw();
      return;
    }
    if ((key.ctrl && key.name === "h") || key.sequence === "\x08") {
      this.helpVisible = true;
      this.draw();
      return;
    }
    if ((key.ctrl && key.name === "z") || key.sequence === "\x1a") {
      this.undo();
      this.draw();
      return;
    }
    if ((key.ctrl && key.name === "y") || key.sequence === "\x19") {
      this.redo();
      this.draw();
      return;
    }
    if (this.sidebarActive) {
      this.handleSidebarKey(key);
      return;
    }

    const before = this.snapshot();
    if (key.name === "left") {
      this.editor.moveLeft();
    } else if (key.name === "right") {
      this.editor.moveRight();
    } else if (key.name === "up") {
      this.moveVisual(-1);
    } else if (key.name === "down") {
      this.moveVisual(1);
    } else if (key.name === "home") {
      this.editor.cursorX = 0;
    } else if (key.name === "end") {
      this.editor.cursorX = charLength(this.editor.lines[this.editor.cursorY]);
    } else if (key.name === "pageup") {
      this.pageUp();
    } else if (key.name === "pagedown") {
      this.pageDown();
    } else if (key.name === "return" || key.name === "enter") {
      this.editor.newline();
    } else if (key.sequence === "\x7f" || (key.name === "backspace" && key.sequence !== "\x08")) {
      this.editor.backspace();
    } else if (key.name === "delete") {
      this.editor.deleteForward();
    } else if (str && !key.ctrl && !key.meta && str >= " ") {
      this.editor.insertText(str);
    }

    if (this.editor.toText() !== before.text) {
      this.pushUndo(before);
      this.markDirty();
    }
    this.draw();
  }

  handlePromptKey(str: string, key: Key): void {
    const prompt = this.promptState;
    if (!prompt) {
      return;
    }
    if (key.name === "escape") {
      this.promptState = null;
      prompt.onCancel?.();
      this.draw();
      return;
    }
    if (key.name === "return" || key.name === "enter") {
      const value = prompt.value.trim();
      this.promptState = null;
      prompt.onSubmit(value);
      this.draw();
      return;
    }
    if (key.name === "left") {
      prompt.cursor = Math.max(0, prompt.cursor - 1);
    } else if (key.name === "right") {
      prompt.cursor = Math.min(charLength(prompt.value), prompt.cursor + 1);
    } else if (key.name === "home") {
      prompt.cursor = 0;
    } else if (key.name === "end") {
      prompt.cursor = charLength(prompt.value);
    } else if (key.sequence === "\x7f" || key.name === "backspace") {
      if (prompt.cursor > 0) {
        prompt.value = sliceChars(prompt.value, 0, prompt.cursor - 1) + sliceChars(prompt.value, prompt.cursor);
        prompt.cursor -= 1;
      }
    } else if (key.name === "delete") {
      prompt.value = sliceChars(prompt.value, 0, prompt.cursor) + sliceChars(prompt.value, prompt.cursor + 1);
    } else if (str && !key.ctrl && !key.meta && str >= " ") {
      prompt.value = sliceChars(prompt.value, 0, prompt.cursor) + str + sliceChars(prompt.value, prompt.cursor);
      prompt.cursor += charLength(str);
    }
    this.draw();
  }

  startPrompt(label: string, defaultValue: string, onSubmit: (value: string) => void, onCancel?: () => void): void {
    this.promptState = {
      label,
      value: defaultValue,
      cursor: charLength(defaultValue),
      onSubmit,
      onCancel,
    };
    this.draw();
  }

  promptSaveDirectory(): void {
    this.startPrompt("保存目录", this.saveDir, (value) => {
      const directory = resolveDirectory(value, process.cwd());
      this.saveToDirectory(directory, true);
    }, () => {
      this.status = "已取消保存";
    });
  }

  promptExportDirectory(): void {
    this.startPrompt("导出目录", this.exportDir, (value) => {
      const directory = resolveDirectory(value, process.cwd());
      this.exportDir = directory;
      this.exportMarkdown(directory);
    }, () => {
      this.status = "已取消导出";
    });
  }

  promptNewDocument(): void {
    this.startPrompt("新草稿标题", "未命名草稿", (title) => {
      if (!title) {
        this.status = "已取消新建";
        return;
      }
      if (this.dirty) {
        this.saveToDirectory(this.saveDir, false);
      }
      const doc = new Document(uniqueDraftPath(this.saveDir, title), title);
      doc.save();
      this.documents.unshift(doc);
      this.currentIndex = 0;
      this.sidebarIndex = 0;
      this.sidebarTop = 0;
      this.doc = doc;
      this.editor = EditorState.fromText("");
      this.resetHistory();
      this.dirty = false;
      this.status = `已新建：${title}`;
      this.saveState();
    }, () => {
      this.status = "已取消新建";
    });
  }

  promptRename(): void {
    this.startPrompt("修改标题", this.doc.title, (title) => {
      if (!title) {
        this.status = "已取消改名";
        return;
      }
      this.doc.title = title;
      this.markDirty();
      this.saveToDirectory(this.saveDir, false);
    }, () => {
      this.status = "已取消改名";
    });
  }

  promptSearch(): void {
    this.startPrompt("搜索文本", "", (query) => {
      if (!query) {
        this.status = "已取消搜索";
        return;
      }
      this.search(query);
    }, () => {
      this.status = "已取消搜索";
    });
  }

  markDirty(): void {
    this.doc.content = this.editor.toText();
    this.dirty = true;
  }

  saveToDirectory(directory: string, interactive: boolean): void {
    try {
      mkdirSync(directory, { recursive: true });
      this.doc.content = this.editor.toText();
      const previousPath = this.doc.path;
      const previousDirectory = resolve(dirname(previousPath));
      const currentStem = basename(previousPath, extname(previousPath));
      const titleStem = slugify(this.doc.title);
      const renameWithinDirectory =
        previousDirectory === directory && previousPath.endsWith(DRAFT_SUFFIX) && currentStem !== titleStem;
      const shouldChoosePath = previousDirectory !== directory || !previousPath.endsWith(DRAFT_SUFFIX) || renameWithinDirectory;
      if (shouldChoosePath) {
        this.doc.path = uniqueDraftPath(directory, this.doc.title, previousPath.endsWith(DRAFT_SUFFIX) ? previousPath : undefined);
      }
      this.doc.save();
      if (renameWithinDirectory && previousPath !== this.doc.path && existsSync(previousPath)) {
        unlinkSync(previousPath);
      }
      this.saveDir = directory;
      this.library = directory;
      this.dirty = false;
      this.lastSave = nowSeconds();
      this.refreshLibraryKeeping(this.doc.path);
      this.status = interactive ? `已保存到：${this.doc.path}` : `已保存：${this.doc.path}`;
    } catch (error) {
      this.status = `保存失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  autosaveIfNeeded(): void {
    if (!this.running) {
      return;
    }
    if (this.dirty && nowSeconds() - this.lastSave >= AUTOSAVE_SECONDS) {
      this.saveToDirectory(this.saveDir, false);
      this.status = `已自动保存：${new Date().toLocaleTimeString()}`;
      this.draw();
    }
  }

  exportMarkdown(directory: string): void {
    try {
      if (this.dirty) {
        this.saveToDirectory(this.saveDir, false);
      }
      const target = this.doc.exportMarkdown(directory);
      this.status = `已导出 Markdown：${target}`;
    } catch (error) {
      this.status = `导出失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  nextDocument(): void {
    if (this.dirty) {
      this.saveToDirectory(this.saveDir, false);
    }
    this.openDocument((this.currentIndex + 1) % this.documents.length);
    this.draw();
  }

  previousDocument(): void {
    if (this.dirty) {
      this.saveToDirectory(this.saveDir, false);
    }
    this.openDocument((this.currentIndex - 1 + this.documents.length) % this.documents.length);
    this.draw();
  }

  pageUp(): void {
    const amount = Math.max(1, (process.stdout.rows || 24) - 7);
    this.moveVisual(-amount);
  }

  pageDown(): void {
    const amount = Math.max(1, (process.stdout.rows || 24) - 7);
    this.moveVisual(amount);
  }

  search(query: string): void {
    const startLine = this.editor.cursorY;
    for (let index = startLine; index < this.editor.lines.length; index += 1) {
      const startCol = index === startLine ? this.editor.cursorX + 1 : 0;
      const col = this.findInLine(this.editor.lines[index], query, startCol);
      if (col >= 0) {
        this.editor.cursorY = index;
        this.editor.cursorX = col;
        this.status = `找到：${query}`;
        return;
      }
    }
    for (let index = 0; index <= startLine; index += 1) {
      const col = this.findInLine(this.editor.lines[index], query, 0);
      if (col >= 0) {
        this.editor.cursorY = index;
        this.editor.cursorX = col;
        this.status = `找到：${query}`;
        return;
      }
    }
    this.status = `未找到：${query}`;
  }

  findInLine(line: string, query: string, startCol: number): number {
    const chars = Array.from(line);
    const queryChars = Array.from(query);
    for (let index = startCol; index <= chars.length - queryChars.length; index += 1) {
      if (chars.slice(index, index + queryChars.length).join("") === query) {
        return index;
      }
    }
    return -1;
  }

  counts(): { words: number; chars: number; paragraphs: number } {
    const text = this.editor.toText();
    const chars = Array.from(text.replace(/\s/g, "")).length;
    const words = text.match(/[A-Za-z0-9_]+|[\u4e00-\u9fff]/g)?.length || 0;
    const paragraphs = text.split(/\n\s*\n/).filter((item) => item.trim()).length;
    return { words, chars, paragraphs };
  }

  quit(): void {
    if (!this.running) {
      return;
    }
    if (this.dirty) {
      this.saveToDirectory(this.saveDir, false);
    }
    this.running = false;
    if (this.autosaveTimer) {
      clearInterval(this.autosaveTimer);
    }
    if (this.keyHandler) {
      process.stdin.off("keypress", this.keyHandler);
    }
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
    this.leaveScreen();
  }
}

function usage(): string {
  return [
    "用法：",
    "  node src/main.ts [--dir 目录]",
    "  node src/main.ts --help",
    "",
    "说明：",
    "  --dir, --library  草稿保存目录，默认当前工作目录。",
    "",
    "示例：",
    "  node src/main.ts",
    "  node src/main.ts --dir ./drafts",
  ].join("\n");
}

function parseArgs(argv: string[]): { help: boolean; dir: string } {
  let dir = process.cwd();
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--dir" || arg === "--library") {
      dir = argv[index + 1] || process.cwd();
      index += 1;
    }
  }
  return { help, dir };
}

export function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  new WriterTui(args.dir).run();
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main();
}
