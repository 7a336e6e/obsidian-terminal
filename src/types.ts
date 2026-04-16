import { ITheme } from "@xterm/xterm";

export const VIEW_TYPE_TERMINAL = "obsidian-terminal";

export interface TerminalProfile {
  id: string;
  name: string;
  shellPath: string;
  args: string[];
  env: Record<string, string>;
  icon: string;
}

export interface TerminalThemeDefinition {
  id: string;
  name: string;
  theme: ITheme;
}

export type CwdMode = "vault" | "active-note" | "custom";

export interface PluginSettings {
  defaultProfileId: string;
  cwdMode: CwdMode;
  customCwd: string;
  fontFamily: string;
  fontSize: number;
  activeThemeId: string;
  customProfiles: TerminalProfile[];
  customThemes: TerminalThemeDefinition[];
  shellLoginMode: boolean;
  cursorStyle: "block" | "underline" | "bar";
  cursorBlink: boolean;
  scrollback: number;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultProfileId: "zsh",
  cwdMode: "vault",
  customCwd: "",
  fontFamily: "Menlo, Monaco, 'Courier New', monospace",
  fontSize: 13,
  activeThemeId: "obsidian-sync",
  customProfiles: [],
  customThemes: [],
  shellLoginMode: true,
  cursorStyle: "block",
  cursorBlink: true,
  scrollback: 5000,
};

export interface TerminalTab {
  id: string;
  title: string;
  profileId: string;
  cwd: string;
}

export interface SavedState {
  tabs: TerminalTab[];
  activeTabId: string | null;
}
