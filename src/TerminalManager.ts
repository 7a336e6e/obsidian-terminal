import { ITheme } from "@xterm/xterm";
import { TerminalInstance } from "./TerminalInstance";
import { TerminalProfile, PluginSettings, TerminalTab } from "./types";
import { getProfile } from "./ShellProfile";
import { getTheme } from "./ThemeManager";

let idCounter = 0;

function nextId(): string {
  return `term-${Date.now()}-${++idCounter}`;
}

export class TerminalManager {
  private instances: Map<string, TerminalInstance> = new Map();
  private _activeId: string | null = null;

  /** Callbacks */
  onTabsChanged: (() => void) | null = null;
  onActiveChanged: ((id: string | null) => void) | null = null;

  constructor(
    private settings: PluginSettings,
    private vaultPath: string
  ) {}

  get activeId(): string | null {
    return this._activeId;
  }

  get tabs(): TerminalTab[] {
    const result: TerminalTab[] = [];
    for (const [id, inst] of this.instances) {
      result.push({
        id,
        title: inst.title,
        profileId: inst["profile"].id,
        cwd: inst["cwd"],
      });
    }
    return result;
  }

  get count(): number {
    return this.instances.size;
  }

  getActiveInstance(): TerminalInstance | null {
    if (!this._activeId) return null;
    return this.instances.get(this._activeId) || null;
  }

  getInstance(id: string): TerminalInstance | null {
    return this.instances.get(id) || null;
  }

  /**
   * Create a new terminal instance.
   */
  createTerminal(
    profileId?: string,
    cwd?: string,
    containerEl?: HTMLElement
  ): string {
    const profile = getProfile(
      profileId || this.settings.defaultProfileId,
      this.settings.customProfiles
    );
    const resolvedCwd = cwd || this.resolveDefaultCwd();
    const theme = getTheme(
      this.settings.activeThemeId,
      this.settings.customThemes
    );

    const id = nextId();
    const instance = new TerminalInstance(
      id,
      profile,
      resolvedCwd,
      this.settings,
      theme
    );

    // When the title changes, notify the view to update tabs
    instance.onTitleChange = () => {
      this.onTabsChanged?.();
    };

    // When the process exits, update the title
    instance.onExit = () => {
      this.onTabsChanged?.();
    };

    this.instances.set(id, instance);
    this._activeId = id;

    this.onTabsChanged?.();
    this.onActiveChanged?.(id);

    return id;
  }

  /**
   * Close and dispose a terminal by ID.
   */
  closeTerminal(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;

    instance.dispose();
    this.instances.delete(id);

    // If the closed terminal was active, switch to another
    if (this._activeId === id) {
      const remaining = Array.from(this.instances.keys());
      this._activeId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      this.onActiveChanged?.(this._activeId);
    }

    this.onTabsChanged?.();
  }

  /**
   * Switch to a terminal tab.
   */
  setActive(id: string): void {
    if (!this.instances.has(id)) return;
    this._activeId = id;
    this.onActiveChanged?.(id);
  }

  /**
   * Switch to next/previous terminal tab.
   */
  cycleTab(direction: 1 | -1): void {
    const ids = Array.from(this.instances.keys());
    if (ids.length <= 1) return;
    const currentIdx = ids.indexOf(this._activeId || "");
    const nextIdx = (currentIdx + direction + ids.length) % ids.length;
    this.setActive(ids[nextIdx]);
  }

  /**
   * Apply theme to all terminals.
   */
  applyTheme(theme: ITheme): void {
    for (const inst of this.instances.values()) {
      inst.setTheme(theme);
    }
  }

  /**
   * Update font settings on all terminals.
   */
  applyFont(family: string, size: number): void {
    for (const inst of this.instances.values()) {
      inst.updateFont(family, size);
    }
  }

  /**
   * Send cd to active terminal.
   */
  cdActive(dir: string): void {
    this.getActiveInstance()?.cd(dir);
  }

  /**
   * Update settings reference (called when settings change).
   */
  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /**
   * Dispose all terminals and clean up.
   */
  disposeAll(): void {
    for (const inst of this.instances.values()) {
      inst.dispose();
    }
    this.instances.clear();
    this._activeId = null;
  }

  private resolveDefaultCwd(): string {
    if (this.settings.cwdMode === "custom" && this.settings.customCwd) {
      return this.settings.customCwd;
    }
    return this.vaultPath;
  }
}
