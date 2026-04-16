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

### Tab management

- Click **+** to create a new terminal tab
- **Right-click +** to choose a shell profile
- **Right-click a tab** to rename, close, or close other tabs
- Click the **×** on a tab to close it

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

### Custom Shell Profiles
Add custom profiles with a name, shell path, arguments, and environment variables.

## Architecture

```
src/
├── main.ts              # Plugin entry point — lifecycle, commands, event listeners
├── TerminalView.ts      # Obsidian ItemView — tab bar UI, container management
├── TerminalManager.ts   # Manages multiple TerminalInstance objects
├── TerminalInstance.ts   # xterm.js ↔ Python PTY bridge
├── ThemeManager.ts      # Theme definitions + Obsidian CSS variable sync
├── ShellProfile.ts      # Built-in and custom shell profile definitions
├── settings.ts          # Plugin settings UI (PluginSettingTab)
├── types.ts             # Shared interfaces, constants, defaults
└── xterm-css.d.ts       # Type declaration for CSS string import
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

## License

[MIT](LICENSE)
