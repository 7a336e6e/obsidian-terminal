# Obsidian Terminal

An integrated terminal emulator for [Obsidian](https://obsidian.md) — open a terminal panel at the bottom of your workspace, just like VS Code's integrated terminal.

Built with [xterm.js](https://xtermjs.org/) and a lightweight Python PTY bridge. No native Node modules required.

![macOS](https://img.shields.io/badge/platform-macOS-blue)
![Obsidian](https://img.shields.io/badge/obsidian-%3E%3D1.0.0-purple)

## Features

- **Bottom panel terminal** — opens as a horizontal split at the bottom of your workspace
- **Multiple tabs** — create, rename, close, and cycle through terminal tabs
- **Shell profiles** — built-in zsh and bash profiles, plus custom profile support
- **Theme sync** — "Obsidian Sync" theme reads your vault's CSS variables so the terminal matches your active theme (light or dark)
- **Built-in themes** — Dark, Light, Monokai, and Dracula
- **Working directory sync** — vault root, active note's folder, or a custom path
- **Resize handling** — terminal auto-resizes with the panel
- **Clickable links** — URLs in terminal output are clickable
- **Search** — search terminal output with `Cmd+F`
- **Editor integration** — let `claude` (and other CLIs) automatically see your active note and current selection, like VS Code's IDE integration
- **Login shell** — optionally start shells with the `-l` flag to load your `.zprofile`/`.bash_profile`
- **Configurable** — font family, font size, cursor style, scrollback buffer, and more

## Requirements

- **macOS** (desktop only — this plugin uses `python3` and POSIX PTY APIs)
- **Python 3** — pre-installed on macOS. The plugin uses Python's `pty` module to create real pseudo-terminals
- **Obsidian** ≥ 1.0.0

## Installation

### Manual installation (recommended for private/development use)

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/7a336e6e/obsidian-terminal.git
   cd obsidian-terminal
   ```

2. **Install dependencies and build:**
   ```bash
   npm install
   npm run build
   ```

3. **Copy the plugin to your vault:**
   ```bash
   VAULT="/path/to/your/vault"
   PLUGIN_DIR="$VAULT/.obsidian/plugins/obsidian-terminal"
   mkdir -p "$PLUGIN_DIR"
   cp main.js manifest.json styles.css "$PLUGIN_DIR/"
   ```

4. **Enable the plugin** in Obsidian:
   - Open **Settings → Community plugins**
   - If prompted, enable community plugins
   - Find **Terminal** in the list and toggle it on
   - If you don't see it, click **Reload plugins**

### Quick deploy script

```bash
npm run build && \
  cp main.js manifest.json styles.css "/path/to/vault/.obsidian/plugins/obsidian-terminal/"
```

## Usage

### Opening the terminal

| Method | Action |
|--------|--------|
| **Ribbon icon** | Click the terminal icon in the left sidebar |
| **Command palette** | `Terminal: Open terminal` |
| **Toggle** | `Terminal: Toggle terminal panel` |
| **Status bar** | Click "Terminal" in the bottom status bar |
| **Hotkey** | Assign your own hotkey in Settings → Hotkeys |

### Commands

| Command | Description |
|---------|-------------|
| `Open terminal` | Opens terminal panel (or reveals if already open) |
| `Toggle terminal panel` | Show/hide the terminal panel |
| `New terminal tab` | Create a new tab in the terminal panel |
| `Next terminal tab` | Switch to next tab |
| `Previous terminal tab` | Switch to previous tab |
| `Open terminal in current note's folder` | New tab with CWD set to the active note's directory |
| `Split terminal right` | Split the focused pane, new terminal beside it |
| `Split terminal down` | Split the focused pane, new terminal below it |
| `Focus next terminal pane` | Move focus to the next pane in the current tab |
| `Focus previous terminal pane` | Move focus to the previous pane in the current tab |

### Tab management

The panel has a single VS Code-style header: the **Terminal** title, your terminal tabs, and actions on the right.

- Click **+** to create a new terminal tab; click **⌄** (or right-click **+**) to choose a shell profile
- Click the **trash** icon to kill the focused terminal
- Click **⋯** to rename, clear or search the focused terminal, close the other tabs, or close the panel
- **Right-click a tab** to rename, split, close, or close other tabs
- Click the **×** on a tab to close it, with every pane in it

### Split panes

Like VS Code, a tab can hold several terminals side by side or stacked, and splits can nest (split right, then split
one side down). A new pane starts with the same shell profile and working directory as the one it was split from.
A tab's label lists its panes' titles.

- Click the **split right** or **split down** icon in the header, or right-click inside a terminal
- Click a pane to focus it; the focused pane has a thin accent outline
- Drag the line between panes to resize them; double-click it to make them equal
- The trash icon (or **Close pane** in the right-click menu) closes just the focused pane
- Layouts and pane sizes are saved with the session and restored with **Restore tabs on startup**

Keyboard (macOS, while the terminal has focus): **⌘\\** splits right, **⌘⇧\\** splits down, **⌥⌘ + arrow keys**
move focus to the pane in that direction. ⌘ combinations never reach the shell, so nothing is taken away from
programs running in it. On other platforms, assign hotkeys to the split and focus commands in Settings → Hotkeys.

With **Compact header** on (the default), Obsidian's own tab and navigation bar above the terminal are hidden while it
has a pane of its own. Turn it off in **Settings → Terminal → Appearance** to get them back, for example to drag the
panel somewhere else.

### Editor integration (let the terminal see your notes)

Off by default. Enable under **Settings → Terminal → Editor integration**. Two independent switches:

**Claude Code IDE integration** — the plugin hosts the same kind of localhost server VS Code
uses for its Claude Code integration. Turn it on, then **open a new terminal tab** and run
`claude`. It auto-connects, so the chat already knows which note you're viewing and what text
you've selected — and updates live as you click around. Verify the connection with `/status`
inside Claude.

**Context bridge (any CLI)** — exposes the same context to *any* program, not just Claude:

- `$OBSIDIAN_ACTIVE_FILE` — absolute path of the active note (set when the terminal is opened)
- `$OBSIDIAN_SELECTION` — the selected text at spawn time
- `$OBSIDIAN_TERM_CONTEXT_FILE` — path to a JSON file that is updated **live** with the active
  note + selection. `cat "$OBSIDIAN_TERM_CONTEXT_FILE"` any time to read the current context.
- `$OBSIDIAN_VAULT_PATH` — the vault root

> **Note:** env vars are captured when a terminal is created, so open a fresh tab after enabling.
> **Security:** the IDE server binds to `127.0.0.1` only and requires an auth token stored in
> `~/.claude/ide/<port>.lock`; the lock file is removed when you disable the feature or close Obsidian.

## Configuration

Open **Settings → Terminal** to configure:

### Shell
- **Default profile** — which shell to use for new terminals (zsh, bash, or custom)
- **Login shell** — start with `-l` flag to source `.zprofile` / `.bash_profile`

### Working Directory
- **Vault root** — new terminals open in your vault's root directory
- **Active note's folder** — CWD follows the currently open note
- **Custom path** — an absolute path of your choice

### Appearance
- **Theme** — Obsidian Sync (matches vault), Dark, Light, Monokai, Dracula
- **Font family** — default: `Menlo, Monaco, 'Courier New', monospace`
- **Font size** — 8–32px (default: 13)
- **Cursor style** — block, underline, or bar
- **Cursor blink** — on/off
- **Scrollback** — 100–100,000 lines (default: 5,000)
- **Compact header** — one header row; hides Obsidian's tab and navigation bar above the terminal (default: on)

### Custom Shell Profiles
Add custom profiles with a name, shell path, arguments, and environment variables.

### Editor integration
- **Claude Code IDE integration** — host a localhost WS/MCP server so `claude` in a terminal knows your active note and selection
- **Context bridge** — expose the active note and selection to any CLI via env vars and a live `~/.obsidian-term/context.json`

## Architecture

```
src/
├── main.ts              # Plugin entry point — lifecycle, commands, event listeners
├── TerminalView.ts      # Obsidian ItemView — tab bar UI, split-pane layout, container management
├── TerminalManager.ts   # Manages multiple TerminalInstance objects
├── TerminalInstance.ts   # xterm.js ↔ Python PTY bridge
├── ThemeManager.ts      # Theme definitions + Obsidian CSS variable sync
├── ShellProfile.ts      # Built-in and custom shell profile definitions
├── settings.ts          # Plugin settings UI (PluginSettingTab)
├── types.ts             # Shared interfaces, constants, defaults
├── xterm-css.d.ts       # Type declaration for CSS string import
└── ide/                 # Editor integration (active note + selection → terminal)
    ├── ContextProvider.ts # Single source of editor truth
    ├── IdeServer.ts       # Claude Code IDE integration (WS/MCP server + lock file)
    ├── WsServer.ts        # Minimal RFC 6455 WebSocket server (no dependencies)
    └── ContextBridge.ts   # Generic env vars + live context.json
```

### How it works

The plugin avoids native Node modules (like `node-pty`) by using an embedded Python script that leverages Python's built-in `pty` module:

1. **Spawn**: `python3 -c <PTY_HELPER_SCRIPT> /bin/zsh -l`
2. The Python script calls `pty.openpty()` to create a real pseudo-terminal
3. It `fork()`s, attaches the slave PTY to the child (your shell), and multiplexes I/O via `select()`
4. **Resize**: xterm.js sends an in-band DCS escape sequence (`ESC P r e s z <rows>;<cols> ESC \`) through stdin; the Python helper intercepts it and calls `ioctl(TIOCSWINSZ)` + `SIGWINCH`
5. **Output**: shell output flows from the master PTY → Python's stdout → Node.js child_process → xterm.js

This gives you full TTY support (colors, line editing, job control, `htop`, `vim`, etc.) without any compilation step or native dependencies.

## Development

```bash
# Install dependencies
npm install

# Development mode (watch + rebuild)
npm run dev

# Production build
npm run build
```

The build uses [esbuild](https://esbuild.github.io/) with a custom plugin that inlines xterm.js CSS as a string export (avoiding separate CSS file loading in Obsidian's sandboxed environment).

## Troubleshooting

### Terminal doesn't appear
- Make sure the plugin is enabled in Settings → Community plugins
- Try the command palette: `Terminal: Open terminal`
- Check the developer console (`Cmd+Option+I`) for errors

### "python3 not found" or process exits immediately
- Verify Python 3 is installed: `python3 --version`
- The plugin expects `python3` on your PATH

### Colors don't match my Obsidian theme
- Ensure the theme is set to **Obsidian Sync** in Settings → Terminal → Appearance → Theme
- The terminal reads CSS variables from Obsidian's body element on creation and on theme change

### Shell doesn't load my aliases / PATH
- Enable **Login shell** in settings (adds the `-l` flag)
- This makes the shell read your `.zprofile`, `.bash_profile`, etc.

### `claude` doesn't see my active note / selection
- Enable **Claude Code IDE integration** in Settings → Terminal → Editor integration
- **Open a new terminal tab** after enabling — the connection env vars are set when the tab is created, not retroactively
- Run `claude` in that fresh tab; check `/status` inside Claude to confirm the IDE shows as connected
- Confirm the lock file exists: `cat ~/.claude/ide/*.lock`

## License

[MIT](LICENSE)
