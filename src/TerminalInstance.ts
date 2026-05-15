import { Terminal, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { ChildProcess } from "child_process";
import { TerminalProfile, PluginSettings } from "./types";
import { PtyBackend, PosixPythonPtyBackend } from "./PtyBackend";
import xtermCss from "@xterm/xterm/css/xterm.css";
import * as path from "path";

let cssInjected = false;

function injectXtermCss() {
  if (cssInjected) return;
  const style = document.createElement("style");
  style.id = "obsidian-terminal-xterm-css";
  style.textContent = xtermCss;
  document.head.appendChild(style);
  cssInjected = true;
}

export class TerminalInstance {
  readonly id: string;
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  readonly searchAddon: SearchAddon;

  private process: ChildProcess | null = null;
  private containerEl: HTMLElement | null = null;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private backend: PtyBackend;

  private _title: string;
  private _cwd: string;
  private _profileId: string;
  private _isRunning = false;

  // Callbacks wired up by TerminalManager / TerminalView
  onTitleChange: ((title: string) => void) | null = null;
  onExit: ((code: number | null) => void) | null = null;
  onSearchToggle: (() => void) | null = null;

  get title(): string {
    return this._title;
  }

  get cwd(): string {
    return this._cwd;
  }

  get profileId(): string {
    return this._profileId;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  constructor(
    id: string,
    private profile: TerminalProfile,
    cwd: string,
    private settings: PluginSettings,
    theme: ITheme,
    backend?: PtyBackend
  ) {
    this.id = id;
    this._title = profile.name;
    this._cwd = cwd;
    this._profileId = profile.id;
    this.backend = backend ?? new PosixPythonPtyBackend();

    injectXtermCss();

    this.terminal = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink,
      scrollback: settings.scrollback,
      allowProposedApi: true,
      theme,
    });

    this.fitAddon = new FitAddon();
    this.searchAddon = new SearchAddon();

    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());
    this.terminal.loadAddon(this.searchAddon);

    this.terminal.onTitleChange((t) => {
      this._title = t;
      this.onTitleChange?.(t);
    });

    // OSC 7 — shell-emitted CWD notification (requires shell config, e.g. chpwd in zsh)
    this.terminal.parser.registerOscHandler(7, (data) => {
      try {
        // data is like "file://hostname/abs/path"
        const url = new URL(data);
        const decoded = decodeURIComponent(url.pathname);
        if (decoded) {
          this._cwd = decoded;
          // Update title to folder basename unless the user manually renamed it
          const base = path.basename(decoded);
          if (base) {
            this._title = base;
            this.onTitleChange?.(this._title);
          }
        }
      } catch {
        // ignore malformed OSC 7
      }
      return true;
    });

    // Copy-on-select
    this.terminal.onSelectionChange(() => {
      if (!this.settings.copyOnSelect) return;
      const sel = this.terminal.getSelection();
      if (sel) navigator.clipboard.writeText(sel).catch(() => {/* ignore */});
    });

    // Intercept Mod+F to toggle search overlay
    this.terminal.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type !== "keydown") return true;
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        this.onSearchToggle?.();
        return false;
      }
      return true;
    });
  }

  /**
   * Attach the terminal to a DOM element and spawn the shell process.
   */
  attach(container: HTMLElement): void {
    if (process.platform === "win32") {
      this.containerEl = container;
      this.terminal.open(container);
      this.terminal.write(
        "\r\n\x1b[31m[Windows is not yet supported. See CLAUDE.md for details.]\x1b[0m\r\n"
      );
      return;
    }

    this.containerEl = container;
    this.terminal.open(container);
    this._isRunning = true;

    requestAnimationFrame(() => {
      this.fit();
      this.spawnShell();
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this.resizeObserver.observe(container);
  }

  /**
   * Detach the terminal from its container without killing the process.
   */
  detach(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.containerEl = null;
  }

  /**
   * Re-attach to a (possibly new) container.
   */
  reattach(container: HTMLElement): void {
    this.containerEl = container;

    if (this.terminal.element) {
      container.appendChild(this.terminal.element);
    } else {
      this.terminal.open(container);
    }

    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this.resizeObserver.observe(container);

    requestAnimationFrame(() => this.fit());
  }

  fit(): void {
    try {
      this.fitAddon.fit();
      this.sendResize(this.terminal.rows, this.terminal.cols);
    } catch {
      // ignore fit errors when container is hidden
    }
  }

  setTheme(theme: ITheme): void {
    this.terminal.options.theme = theme;
  }

  updateFont(family: string, size: number): void {
    this.terminal.options.fontFamily = family;
    this.terminal.options.fontSize = size;
    this.fit();
  }

  setTitle(title: string): void {
    this._title = title;
    this.onTitleChange?.(title);
  }

  clear(): void {
    this.terminal.clear();
  }

  /** Send a cd command to this shell. Sends Ctrl-U first to clear any pending input. */
  cd(dir: string): void {
    if (this.process && !this.process.killed) {
      const escaped = dir.replace(/'/g, "'\\''");
      // \x15 = Ctrl-U: clears the current input line before cd
      this.process.stdin?.write(`\x15cd '${escaped}'\n`);
    }
  }

  /** Write raw data to the shell stdin — used by send-selection-to-terminal. */
  write(data: string): void {
    if (this.process && !this.process.killed) {
      this.process.stdin?.write(data);
    }
  }

  private sendResize(rows: number, cols: number): void {
    if (this.process && !this.process.killed && this.process.stdin?.writable) {
      this.process.stdin.write(this.backend.encodeResize(rows, cols));
    }
  }

  private spawnShell(): void {
    const { shellPath, args, env: profileEnv } = this.profile;
    const shellArgs = [...args];

    if (this.settings.shellLoginMode && shellArgs.length === 0) {
      shellArgs.push("-l");
    }

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...profileEnv,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      OBSIDIAN_TERMINAL: "1",
    };

    this.process = this.backend.spawn({
      shell: shellPath,
      args: shellArgs,
      cwd: this._cwd,
      env,
      cols: this.terminal.cols,
      rows: this.terminal.rows,
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      if (!this.disposed) {
        this.terminal.write(new Uint8Array(data));
      }
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      if (!this.disposed) {
        this.terminal.write(new Uint8Array(data));
      }
    });

    this.terminal.onData((data: string) => {
      if (this.process && !this.process.killed) {
        this.process.stdin?.write(data);
      }
    });

    this.terminal.onBinary((data: string) => {
      if (this.process && !this.process.killed) {
        const buf = Buffer.from(data, "binary");
        this.process.stdin?.write(buf);
      }
    });

    this.process.on("exit", (code) => {
      this._isRunning = false;
      if (!this.disposed) {
        this.terminal.write(
          `\r\n\x1b[90m[Process exited with code ${code ?? "unknown"}]\x1b[0m\r\n`
        );
        if (this.settings.reuseTabOnExit) {
          this.terminal.write("\x1b[90m[Press Enter to start a new session]\x1b[0m\r\n");
          // Listen for Enter key to restart the shell
          const disposable = this.terminal.onData((data) => {
            if (data === "\r" || data === "\n") {
              disposable.dispose();
              this._isRunning = true;
              this.spawnShell();
            }
          });
        }
        this.onExit?.(code);
      }
    });

    this.process.on("error", (err) => {
      this._isRunning = false;
      if (!this.disposed) {
        this.terminal.write(
          `\r\n\x1b[31m[Error: ${err.message}]\x1b[0m\r\n`
        );
      }
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this._isRunning = false;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.process && !this.process.killed) {
      try {
        this.process.stdin?.end();
      } catch {
        // ignore
      }

      const proc = this.process;
      setTimeout(() => {
        if (!proc.killed) {
          try {
            proc.kill("SIGTERM");
          } catch {
            // already dead
          }
        }
      }, 500);
    }

    this.terminal.dispose();
    this.process = null;
    this.containerEl = null;
  }
}
