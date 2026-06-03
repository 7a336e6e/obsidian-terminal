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
export type CursorStyle = "block" | "underline" | "bar";

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
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  scrollback: number;
  restoreTabs: boolean;
  confirmOnClose: boolean;
  copyOnSelect: boolean;
  pasteSanitize: boolean;
  reuseTabOnExit: boolean;
  ideIntegration: boolean;
  contextBridge: boolean;
  __session?: SavedState;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  defaultProfileId: "default",
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
  restoreTabs: true,
  confirmOnClose: true,
  copyOnSelect: false,
  pasteSanitize: true,
  reuseTabOnExit: false,
  ideIntegration: false,
  contextBridge: false,
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
