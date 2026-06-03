import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ContextProvider, EditorSnapshot } from "./ContextProvider";

// ContextBridge is the generic, tool-agnostic half of the editor integration.
// It mirrors the active note + selection to env vars (read at spawn time) and a
// live ~/.obsidian-term/context.json file (the live channel any CLI can poll).

export class ContextBridge {
  readonly filePath: string;
  private unsubscribe: (() => void) | null = null;
  private writeTimer: number | null = null;
  private pending: EditorSnapshot | null = null;
  private running = false;

  constructor(
    private contextProvider: ContextProvider,
    private vaultBasePath: string
  ) {
    this.filePath = path.join(os.homedir(), ".obsidian-term", "context.json");
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.unsubscribe = this.contextProvider.onChange((snap) =>
      this.scheduleWrite(snap)
    );
    this.writeFile(this.contextProvider.getLatest());
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.writeTimer !== null) {
      window.clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    try {
      fs.unlinkSync(this.filePath);
    } catch {
      // already gone
    }
  }

  /** Env vars injected into new shells. Static snapshot — context.json is live. */
  getSpawnEnv(): Record<string, string> {
    const env: Record<string, string> = {
      OBSIDIAN_VAULT_PATH: this.vaultBasePath,
      OBSIDIAN_TERM_CONTEXT_FILE: this.filePath,
    };
    const snap = this.contextProvider.getLatest();
    if (snap) {
      env.OBSIDIAN_ACTIVE_FILE = snap.filePathAbs;
      env.OBSIDIAN_SELECTION = snap.text;
    }
    return env;
  }

  private scheduleWrite(snap: EditorSnapshot | null): void {
    // Keep the last known file when focus moves to a non-editor view (e.g. the
    // terminal itself) so a script reading the file still sees your note.
    this.pending = snap ?? this.contextProvider.getLatest();
    if (this.writeTimer !== null) return;
    this.writeTimer = window.setTimeout(() => {
      this.writeTimer = null;
      this.writeFile(this.pending);
    }, 100);
  }

  private writeFile(snap: EditorSnapshot | null): void {
    const payload = {
      vault: this.vaultBasePath,
      activeFile: snap
        ? { abs: snap.filePathAbs, rel: snap.filePathRel }
        : null,
      selection: snap
        ? {
            text: snap.text,
            start: snap.selection.start,
            end: snap.selection.end,
            isEmpty: snap.selection.isEmpty,
          }
        : null,
      updatedAt: new Date().toISOString(),
    };
    const tmp = `${this.filePath}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, this.filePath);
    } catch {
      // best effort — the bridge is non-critical
    }
  }
}
