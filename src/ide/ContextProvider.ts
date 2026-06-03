import {
  App,
  Plugin,
  TFile,
  Editor,
  MarkdownView,
  normalizePath,
} from "obsidian";
import { EditorView, ViewUpdate } from "@codemirror/view";
import * as path from "path";
import { pathToFileURL } from "url";

// ContextProvider is the single place that touches Obsidian editor APIs. Both
// consumers (IdeServer and ContextBridge) subscribe to it, so editor-reading
// logic lives here and nowhere else.

export interface SelectionRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
  isEmpty: boolean;
}

export interface EditorSnapshot {
  filePathAbs: string;
  filePathRel: string;
  fileUrl: string;
  text: string;
  selection: SelectionRange;
}

export interface OpenEditorTab {
  uri: string;
  isActive: boolean;
  label: string;
  languageId: string;
  isDirty: boolean;
}

export interface OpenFileArgs {
  filePath: string;
  startText?: string;
  endText?: string;
}

type Subscriber = (snap: EditorSnapshot | null) => void;

export class ContextProvider {
  private latest: EditorSnapshot | null = null;
  private lastEmitted: EditorSnapshot | null = null;
  private subscribers: Set<Subscriber> = new Set();
  private debounceTimer: number | null = null;

  constructor(
    private app: App,
    private plugin: Plugin,
    private vaultBasePath: string
  ) {}

  /** Register editor/workspace listeners. Auto-cleaned up by the plugin. */
  register(): void {
    this.plugin.registerEditorExtension([
      EditorView.updateListener.of((u: ViewUpdate) => {
        if (u.selectionSet || u.docChanged || u.focusChanged) {
          this.scheduleRefresh();
        }
      }),
    ]);
    this.plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh())
    );
    this.plugin.registerEvent(
      this.app.workspace.on("file-open", () => this.scheduleRefresh())
    );
  }

  /** Subscribe to debounced editor changes. Returns an unsubscribe function. */
  onChange(cb: Subscriber): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  /** The live snapshot of the active editor, or null if none is focused. */
  getCurrent(): EditorSnapshot | null {
    return this.computeSnapshot();
  }

  /** The most recent non-null snapshot — survives focus moving to the terminal. */
  getLatest(): EditorSnapshot | null {
    return this.latest ?? this.computeSnapshot();
  }

  getOpenEditors(): { tabs: OpenEditorTab[] } {
    const activeFile = this.app.workspace.getActiveFile();
    const tabs: OpenEditorTab[] = [];
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file) continue;
      const file = view.file;
      tabs.push({
        uri: this.fileUrl(file.path),
        isActive: activeFile?.path === file.path,
        label: file.basename,
        languageId: "markdown",
        isDirty: false,
      });
    }
    return { tabs };
  }

  getWorkspaceFolders(): {
    success: boolean;
    folders: { name: string; uri: string; path: string }[];
    rootPath: string;
  } {
    const base = this.vaultBasePath;
    return {
      success: true,
      folders: [
        {
          name: this.app.vault.getName(),
          uri: pathToFileURL(base).href,
          path: base,
        },
      ],
      rootPath: base,
    };
  }

  async openFile(
    args: OpenFileArgs
  ): Promise<{ success: boolean; message: string }> {
    const rel = this.toVaultRelative(args.filePath);
    const file = rel ? this.app.vault.getAbstractFileByPath(rel) : null;
    if (!(file instanceof TFile)) {
      return { success: false, message: `File not found in vault: ${args.filePath}` };
    }

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);

    if (args.startText) {
      const editor = this.app.workspace.activeEditor?.editor;
      if (editor) selectByText(editor, args.startText, args.endText);
    }

    return { success: true, message: `Opened ${rel}` };
  }

  dispose(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.subscribers.clear();
  }

  // ------ internals ------

  private scheduleRefresh(): void {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.refresh();
    }, 75);
  }

  private refresh(): void {
    const snap = this.computeSnapshot();
    if (snap) this.latest = snap;
    if (!snapshotsEqual(snap, this.lastEmitted)) {
      this.lastEmitted = snap;
      for (const cb of this.subscribers) cb(snap);
    }
  }

  private computeSnapshot(): EditorSnapshot | null {
    const info = this.app.workspace.activeEditor;
    if (!info || !info.editor || !info.file) return null;
    return this.buildSnapshot(info.file, info.editor);
  }

  private buildSnapshot(file: TFile, editor: Editor): EditorSnapshot {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    const abs = path.join(this.vaultBasePath, file.path);
    return {
      filePathAbs: abs,
      filePathRel: file.path,
      fileUrl: pathToFileURL(abs).href,
      text: editor.getSelection(),
      selection: {
        start: { line: from.line, character: from.ch },
        end: { line: to.line, character: to.ch },
        isEmpty: from.line === to.line && from.ch === to.ch,
      },
    };
  }

  private fileUrl(relPath: string): string {
    return pathToFileURL(path.join(this.vaultBasePath, relPath)).href;
  }

  private toVaultRelative(p: string): string | null {
    if (!path.isAbsolute(p)) return normalizePath(p);
    const rel = path.relative(this.vaultBasePath, p);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return normalizePath(rel);
  }
}

function selectByText(editor: Editor, startText: string, endText?: string): void {
  const full = editor.getValue();
  const startIdx = full.indexOf(startText);
  if (startIdx === -1) return;

  let endOffset = startIdx + startText.length;
  if (endText) {
    const endIdx = full.indexOf(endText, endOffset);
    if (endIdx !== -1) endOffset = endIdx + endText.length;
  }

  const startPos = editor.offsetToPos(startIdx);
  const endPos = editor.offsetToPos(endOffset);
  editor.setSelection(startPos, endPos);
  editor.scrollIntoView({ from: startPos, to: endPos }, true);
}

function snapshotsEqual(
  a: EditorSnapshot | null,
  b: EditorSnapshot | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.filePathAbs === b.filePathAbs &&
    a.text === b.text &&
    a.selection.start.line === b.selection.start.line &&
    a.selection.start.character === b.selection.start.character &&
    a.selection.end.line === b.selection.end.line &&
    a.selection.end.character === b.selection.end.character
  );
}
