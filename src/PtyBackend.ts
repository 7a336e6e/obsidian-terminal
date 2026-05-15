import { ChildProcess, spawn } from "child_process";

export interface PtySpawnOptions {
  shell: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cols: number;
  rows: number;
}

export interface PtyBackend {
  spawn(opts: PtySpawnOptions): ChildProcess;
  encodeResize(rows: number, cols: number): string;
}

// In-band resize escape protocol (DCS-based):
//   ESC P r e s z <rows>;<cols> ESC \
// The Python PTY helper intercepts this before forwarding to the shell.
export const RESIZE_PREFIX = "\x1bPresz";
export const RESIZE_SUFFIX = "\x1b\\";

// Python PTY helper — creates a real pseudo-terminal so the shell gets full
// TTY support (colors, line editing, job control) without native modules.
// Resize commands are passed in-band via the DCS escape sequence above.
// Keep this self-contained: no f-strings, no third-party imports.
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

export class PosixPythonPtyBackend implements PtyBackend {
  spawn(opts: PtySpawnOptions): ChildProcess {
    return spawn(
      "python3",
      ["-c", PTY_HELPER, opts.shell, ...opts.args],
      {
        cwd: opts.cwd,
        env: {
          ...opts.env,
          COLUMNS: String(opts.cols),
          LINES: String(opts.rows),
        },
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  }

  encodeResize(rows: number, cols: number): string {
    return `${RESIZE_PREFIX}${rows};${cols}${RESIZE_SUFFIX}`;
  }
}
