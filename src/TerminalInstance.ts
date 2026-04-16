import { Terminal, ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { ChildProcess, spawn } from "child_process";
import { TerminalProfile, PluginSettings } from "./types";
import xtermCss from "@xterm/xterm/css/xterm.css";

let cssInjected = false;

function injectXtermCss() {
  if (cssInjected) return;
  const style = document.createElement("style");
  style.id = "obsidian-terminal-xterm-css";
  style.textContent = xtermCss;
  document.head.appendChild(style);
  cssInjected = true;
}

// Resize escape protocol (DCS-based):
//   Send:  ESC P r e s z <rows>;<cols> ESC \
// The Python PTY helper intercepts these before forwarding to the shell.
const RESIZE_PREFIX = "\x1bPresz";
const RESIZE_SUFFIX = "\x1b\\";

// Python PTY helper script.
// Creates a real pseudo-terminal so the shell gets full TTY support
// (colors, line editing, job control) without requiring native modules (node-pty).
// Resize commands are passed in-band via the DCS escape sequence above.
const PTY_HELPER = `
import pty, os, sys, select, signal, struct, fcntl, termios, errno

ESC = bytes([27])
RESIZE_START = ESC + b'Presz'
RESIZE_END = ESC + bytes([92])

def set_size(fd, rows, cols):
    s = struct.pack('HHHH', rows, cols, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, s)

def main():
    shell = sys.argv[1:] or [os.environ.get('SHELL', '/bin/zsh')]
    master_fd, slave_fd = pty.openpty()

    rows = int(os.environ.get('LINES', '24'))
    cols = int(os.environ.get('COLUMNS', '80'))
    set_size(master_fd, rows, cols)

    pid = os.fork()
    if pid == 0:
        os.close(master_fd)
        os.setsid()
        fcntl.ioctl(slave_fd, termios.TIOCSCTTY, 0)
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        if slave_fd > 2:
            os.close(slave_fd)
        os.execvp(shell[0], shell)
        sys.exit(1)

    os.close(slave_fd)

    def cleanup():
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            os.kill(pid, signal.SIGHUP)
        except OSError:
            pass
        try:
            os.waitpid(pid, 0)
        except (OSError, ChildProcessError):
            pass

    def on_sigterm(sig, frame):
        cleanup()
        sys.exit(0)

    signal.signal(signal.SIGTERM, on_sigterm)

    buf = b''
    try:
        while True:
            try:
                rlist, _, _ = select.select([master_fd, 0], [], [], 0.5)
            except (select.error, InterruptedError, ValueError):
                continue

            if 0 in rlist:
                try:
                    data = os.read(0, 16384)
                except OSError as e:
                    if e.errno == errno.EIO:
                        break
                    raise
                if not data:
                    break

                buf += data
                while RESIZE_START in buf:
                    pre, _, rest = buf.partition(RESIZE_START)
                    if RESIZE_END in rest:
                        payload, _, rest = rest.partition(RESIZE_END)
                        if pre:
                            os.write(master_fd, pre)
                        try:
                            r, c = payload.decode().split(';')
                            set_size(master_fd, int(r), int(c))
                            os.kill(pid, signal.SIGWINCH)
                        except (ValueError, OSError):
                            pass
                        buf = rest
                    else:
                        break
                if buf and RESIZE_START not in buf:
                    os.write(master_fd, buf)
                    buf = b''

            if master_fd in rlist:
                try:
                    data = os.read(master_fd, 16384)
                except OSError as e:
                    if e.errno == errno.EIO:
                        break
                    raise
                if not data:
                    break
                os.write(1, data)
    except (IOError, OSError):
        pass
    finally:
        cleanup()

main()
`;

export class TerminalInstance {
  readonly id: string;
  readonly terminal: Terminal;
  readonly fitAddon: FitAddon;
  readonly searchAddon: SearchAddon;

  private process: ChildProcess | null = null;
  private containerEl: HTMLElement | null = null;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;

  onTitleChange: ((title: string) => void) | null = null;
  onExit: ((code: number | null) => void) | null = null;

  private _title: string;

  get title(): string {
    return this._title;
  }

  constructor(
    id: string,
    private profile: TerminalProfile,
    private cwd: string,
    private settings: PluginSettings,
    theme: ITheme
  ) {
    this.id = id;
    this._title = profile.name;

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

    // Track title changes from shell escape sequences
    this.terminal.onTitleChange((t) => {
      this._title = t;
      this.onTitleChange?.(t);
    });
  }

  /**
   * Attach the terminal to a DOM element and spawn the shell process.
   */
  attach(container: HTMLElement): void {
    this.containerEl = container;
    this.terminal.open(container);

    // Initial fit
    requestAnimationFrame(() => {
      this.fit();
      this.spawnShell();
    });

    // Auto-resize when container dimensions change
    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this.resizeObserver.observe(container);
  }

  /**
   * Detach the terminal from its container without killing the process.
   * Used when switching tabs (hide).
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

    // xterm.js open() can only be called once. Instead, move the DOM node.
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

  /** Apply a new theme live. */
  setTheme(theme: ITheme): void {
    this.terminal.options.theme = theme;
  }

  /** Update font settings live. */
  updateFont(family: string, size: number): void {
    this.terminal.options.fontFamily = family;
    this.terminal.options.fontSize = size;
    this.fit();
  }

  /** Send a cd command to this shell. */
  cd(dir: string): void {
    if (this.process && !this.process.killed) {
      const escaped = dir.replace(/'/g, "'\\''");
      this.process.stdin?.write(`cd '${escaped}'\n`);
    }
  }

  /** Send a resize command to the PTY helper via the in-band escape protocol. */
  private sendResize(rows: number, cols: number): void {
    if (this.process && !this.process.killed && this.process.stdin?.writable) {
      this.process.stdin.write(`${RESIZE_PREFIX}${rows};${cols}${RESIZE_SUFFIX}`);
    }
  }

  private spawnShell(): void {
    const { shellPath, args, env: profileEnv } = this.profile;
    const shellArgs = [...args];

    // Use login shell if configured and no args override it
    if (this.settings.shellLoginMode && shellArgs.length === 0) {
      shellArgs.push("-l");
    }

    const env: Record<string, string> = {
      ...process.env,
      ...profileEnv,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      OBSIDIAN_TERMINAL: "1",
      COLUMNS: String(this.terminal.cols),
      LINES: String(this.terminal.rows),
    };

    // Use Python PTY helper for proper pseudo-terminal support.
    // This gives the shell a real TTY (colors, line editing, job control)
    // without requiring native modules like node-pty.
    this.process = spawn(
      "python3",
      ["-c", PTY_HELPER, shellPath, ...shellArgs],
      {
        cwd: this.cwd,
        env,
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    // Shell output → xterm
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

    // User input → shell stdin (via Python PTY helper)
    this.terminal.onData((data: string) => {
      if (this.process && !this.process.killed) {
        this.process.stdin?.write(data);
      }
    });

    // Handle binary input (e.g., Ctrl+C sends \x03)
    this.terminal.onBinary((data: string) => {
      if (this.process && !this.process.killed) {
        const buf = Buffer.from(data, "binary");
        this.process.stdin?.write(buf);
      }
    });

    // Process exit
    this.process.on("exit", (code) => {
      if (!this.disposed) {
        this.terminal.write(
          `\r\n\x1b[90m[Process exited with code ${code ?? "unknown"}]\x1b[0m\r\n`
        );
        this.onExit?.(code);
      }
    });

    this.process.on("error", (err) => {
      if (!this.disposed) {
        this.terminal.write(
          `\r\n\x1b[31m[Error: ${err.message}]\x1b[0m\r\n`
        );
      }
    });
  }

  /**
   * Dispose the terminal instance — kills the process and cleans up.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    if (this.process && !this.process.killed) {
      // Close stdin first — triggers clean exit in the Python helper,
      // which sends SIGHUP to the shell child.
      try {
        this.process.stdin?.end();
      } catch {
        // ignore
      }

      // Fallback: force kill after a short grace period
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
