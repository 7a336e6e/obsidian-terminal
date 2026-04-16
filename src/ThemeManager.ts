import { ITheme } from "@xterm/xterm";
import { TerminalThemeDefinition } from "./types";

export const BUILTIN_THEMES: TerminalThemeDefinition[] = [
  {
    id: "obsidian-sync",
    name: "Obsidian Sync",
    theme: {}, // placeholder — resolved dynamically
  },
  {
    id: "dark",
    name: "Dark",
    theme: {
      background: "#1e1e1e",
      foreground: "#d4d4d4",
      cursor: "#d4d4d4",
      cursorAccent: "#1e1e1e",
      selectionBackground: "#264f78",
      selectionForeground: "#ffffff",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "light",
    name: "Light",
    theme: {
      background: "#ffffff",
      foreground: "#383a42",
      cursor: "#383a42",
      cursorAccent: "#ffffff",
      selectionBackground: "#bfceff",
      selectionForeground: "#383a42",
      black: "#000000",
      red: "#e45649",
      green: "#50a14f",
      yellow: "#c18401",
      blue: "#4078f2",
      magenta: "#a626a4",
      cyan: "#0184bc",
      white: "#a0a1a7",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#d19a66",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    theme: {
      background: "#272822",
      foreground: "#f8f8f2",
      cursor: "#f8f8f0",
      cursorAccent: "#272822",
      selectionBackground: "#49483e",
      selectionForeground: "#f8f8f2",
      black: "#272822",
      red: "#f92672",
      green: "#a6e22e",
      yellow: "#f4bf75",
      blue: "#66d9ef",
      magenta: "#ae81ff",
      cyan: "#a1efe4",
      white: "#f8f8f2",
      brightBlack: "#75715e",
      brightRed: "#f92672",
      brightGreen: "#a6e22e",
      brightYellow: "#f4bf75",
      brightBlue: "#66d9ef",
      brightMagenta: "#ae81ff",
      brightCyan: "#a1efe4",
      brightWhite: "#f9f8f5",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    theme: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#282a36",
      selectionBackground: "#44475a",
      selectionForeground: "#f8f8f2",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
];

/**
 * Extract terminal theme colors from Obsidian's active CSS variables.
 * Reads from document.body where Obsidian applies --background-primary etc.
 */
export function resolveObsidianSyncTheme(): ITheme {
  const style = getComputedStyle(document.body);
  const get = (v: string, fallback: string) =>
    style.getPropertyValue(v).trim() || fallback;

  return {
    background: get("--background-primary", "#1e1e1e"),
    foreground: get("--text-normal", "#d4d4d4"),
    cursor: get("--text-normal", "#d4d4d4"),
    cursorAccent: get("--background-primary", "#1e1e1e"),
    selectionBackground: get("--text-selection", "#264f78"),
    selectionForeground: get("--text-on-accent", "#ffffff"),
    black: "#000000",
    red: get("--text-error", "#e45649"),
    green: get("--interactive-success", "#0dbc79"),
    yellow: get("--text-warning", "#e5c07b"),
    blue: get("--interactive-accent", "#2472c8"),
    magenta: "#bc3fbc",
    cyan: "#11a8cd",
    white: get("--text-normal", "#e5e5e5"),
    brightBlack: get("--text-muted", "#666666"),
    brightRed: "#f14c4c",
    brightGreen: "#23d18b",
    brightYellow: "#f5f543",
    brightBlue: get("--interactive-accent-hover", "#3b8eea"),
    brightMagenta: "#d670d6",
    brightCyan: "#29b8db",
    brightWhite: "#ffffff",
  };
}

export function getTheme(
  id: string,
  customThemes: TerminalThemeDefinition[]
): ITheme {
  if (id === "obsidian-sync") {
    return resolveObsidianSyncTheme();
  }

  const allThemes = [...BUILTIN_THEMES, ...customThemes];
  const found = allThemes.find((t) => t.id === id);
  return found?.theme || BUILTIN_THEMES[1].theme; // fallback to dark
}

export function getAllThemes(
  customThemes: TerminalThemeDefinition[]
): TerminalThemeDefinition[] {
  return [...BUILTIN_THEMES, ...customThemes];
}
