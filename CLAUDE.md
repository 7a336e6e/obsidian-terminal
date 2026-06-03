# ObsidianTerm — Claude Onboarding

## What it is

An Obsidian community plugin that embeds a full xterm.js terminal as a bottom-panel `ItemView`. Because Obsidian's sandboxed environment forbids native Node modules, the plugin avoids `node-pty` entirely and instead spawns a Python `pty` helper (`python3 -c <script>`) that creates a real POSIX pseudo-terminal. This gives the shell proper TTY support (colors, line editing, job control, `vim`, `htop`, etc.) on macOS and Linux with zero compilation. Windows is **not yet supported** — `src/PtyBackend.ts` is the seam for a future ConPTY implementation.

## Build / run / deploy

```bash
npm install          # first time only
npm run dev          # watch mode — rebuilds on save
npm run build        # production (minified, no sourcemaps) → main.js
```

Deploy to a local vault (toggle the plugin off/on in Settings → Community plugins after copying):

```bash
VAULT="/path/to/your/vault"
cp main.js manifest.json styles.css "$VAULT/.obsidian/plugins/obsidian-terminal/"
```

There is **no automated test suite** — verification is manual inside Obsidian. See README.md for a full smoke-test checklist.

## Architecture

```
src/
├── main.ts              — Plugin entry point: lifecycle, commands, event listeners
├── TerminalView.ts      — Obsidian ItemView: tab bar, search overlay, context menus
├── TerminalManager.ts   — Owns multiple TerminalInstance objects; handles persistence
├── TerminalInstance.ts  — xterm.js ↔ PtyBackend bridge; one per terminal tab
├── PtyBackend.ts        — Interface + POSIX Python PTY implementation (Windows seam)
├── ThemeManager.ts      — Built-in themes + Obsidian CSS-variable sync
├── ShellProfile.ts      — Platform-aware built-in profiles + custom profile helpers
├── settings.ts          — PluginSettingTab UI
├── modals.ts            — RenameModal, ConfirmCloseModal, EditProfileModal
├── types.ts             — Shared types, constants, DEFAULT_SETTINGS
├── xterm-css.d.ts       — Type declaration for the inlined xterm CSS string import
└── ide/                 — Editor integration (active note + selection → terminal)
    ├── ContextProvider.ts — Single source of editor truth (activeEditor + CM6 listener)
    ├── IdeServer.ts       — Claude Code IDE integration: WS/MCP server + lock file
    ├── WsServer.ts        — Hand-rolled minimal RFC 6455 WebSocket server (no deps)
    └── ContextBridge.ts   — Generic bridge: env vars + live ~/.obsidian-term/context.json
```

## Key invariants and gotchas

- **`terminal.open()` is once-only.** xterm.js may only call `open()` once per `Terminal` instance. Tab-switching works by moving the DOM element (`reattach()`), never by re-opening.
- **Resize is in-band.** The terminal sends `ESC P r e s z <rows>;<cols> ESC \` through stdin; the Python helper intercepts it before forwarding to the shell, then calls `ioctl(TIOCSWINSZ)` + `SIGWINCH`. See `PtyBackend.ts` for the constants.
- **`fit()` is called before the process exists** on the first `requestAnimationFrame`. `sendResize` no-ops safely when the process is null — do not reorder `fit` and `spawnShell` to "fix" this, it is correct.
- **`injectXtermCss()` is module-scoped.** The `cssInjected` flag lives at module level; the function is idempotent across multiple TerminalInstance creations within one page load.
- **`vault.adapter.basePath` is not in Obsidian's public types.** `getVaultBasePath()` in `main.ts` uses `FileSystemAdapter` with a narrow `@ts-expect-error` — keep it isolated there.
- **`cdActive` sends `\x15` (Ctrl-U) before the `cd` command** to clear whatever the user is currently typing. This is intentional — do not remove it.
- **Session persistence** stores only tab metadata (title, profileId, cwd) not scrollback. Shell processes are always fresh on restore.
- **Editor integration is opt-in and off by default** (`ideIntegration`, `contextBridge` settings). The IDE server (`src/ide/IdeServer.ts`) binds **127.0.0.1 only**, requires the `x-claude-code-ide-authorization` token written into `~/.claude/ide/<port>.lock`, and deletes that lock file on stop/unload. It speaks the Claude Code WS-transport MCP protocol — do not "fix" it to plain HTTP/SSE.
- **Integration env is injected at spawn, per-terminal.** `getInjectedTerminalEnv()` in `main.ts` is threaded down through `TerminalView → TerminalManager → TerminalInstance` and merged in `spawnShell()`. Toggling the feature only affects terminals opened *after* the change — existing shells keep their spawn-time env (same as VS Code). `ContextProvider` is the only place that touches Obsidian editor APIs; both `IdeServer` and `ContextBridge` subscribe to it.

## Conventions

- `strictNullChecks` is on — prefer `?.` and early-return guards over `as any`.
- **No native modules.** The Python PTY approach exists specifically to avoid `node-pty`. If you reach for `node-pty`, stop.
- User-visible strings: sentence case, no emoji.
- 2-space indent; files end with a newline (match existing style).
- Avoid `@ts-ignore` — use `@ts-expect-error` with a one-line justification comment when unavoidable.

## What is intentionally absent

- No automated tests
- No i18n / localisation
- No Windows support (yet) — `PtyBackend.ts` is the integration seam
- No mobile support (`isDesktopOnly: true` in `manifest.json`)

See `README.md` for end-user documentation and a full troubleshooting guide.
