import { ITheme } from "@xterm/xterm";
import { TerminalInstance } from "./TerminalInstance";
import { TerminalProfile, PluginSettings, TerminalTab, SavedState } from "./types";
import { getProfile } from "./ShellProfile";
import { getTheme } from "./ThemeManager";

let idCounter = 0;

function nextId(): string {
  return `term-${Date.now()}-${++idCounter}`;
}

export class TerminalManager {
  private instances: Map<string, TerminalInstance> = new Map();
  private order: string[] = []; // explicit tab order for drag-reorder
  private _activeId: string | null = null;

  onTabsChanged: (() => void) | null = null;
  onActiveChanged: ((id: string | null) => void) | null = null;

  constructor(
    private settings: PluginSettings,
    private vaultPath: string,
    private getInjectedEnv?: () => Record<string, string>
  ) {}

  get activeId(): string | null {
    return this._activeId;
  }

  get tabs(): TerminalTab[] {
    return this.order
      .filter((id) => this.instances.has(id))
      .map((id) => {
        const inst = this.instances.get(id)!;
        return {
          id,
          title: inst.title,
          profileId: inst.profileId,
          cwd: inst.cwd,
        };
      });
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
      theme,
      undefined,
      this.getInjectedEnv
    );

    instance.onTitleChange = () => {
      this.onTabsChanged?.();
    };

    instance.onExit = () => {
      this.onTabsChanged?.();
    };

    this.instances.set(id, instance);
    this.order.push(id);
    this._activeId = id;

    this.onTabsChanged?.();
    this.onActiveChanged?.(id);

    return id;
  }

  closeTerminal(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;

    instance.dispose();
    this.instances.delete(id);
    this.order = this.order.filter((oid) => oid !== id);

    if (this._activeId === id) {
      const remaining = this.order;
      this._activeId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
      this.onActiveChanged?.(this._activeId);
    }

    this.onTabsChanged?.();
  }

  setActive(id: string): void {
    if (!this.instances.has(id)) return;
    this._activeId = id;
    this.onActiveChanged?.(id);
  }

  cycleTab(direction: 1 | -1): void {
    if (this.order.length <= 1) return;
    const currentIdx = this.order.indexOf(this._activeId || "");
    const nextIdx = (currentIdx + direction + this.order.length) % this.order.length;
    this.setActive(this.order[nextIdx]);
  }

  /** Move a tab to a new position (drag-reorder). */
  reorderTab(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const fromIdx = this.order.indexOf(fromId);
    const toIdx = this.order.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    this.order.splice(fromIdx, 1);
    this.order.splice(toIdx, 0, fromId);
    this.onTabsChanged?.();
  }

  applyTheme(theme: ITheme): void {
    for (const inst of this.instances.values()) {
      inst.setTheme(theme);
    }
  }

  applyFont(family: string, size: number): void {
    for (const inst of this.instances.values()) {
      inst.updateFont(family, size);
    }
  }

  /** Send cd to active terminal. Sends Ctrl-U first to avoid clobbering input. */
  cdActive(dir: string): void {
    this.getActiveInstance()?.cd(dir);
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
  }

  /** Serialize current tab state for session persistence. */
  serialize(): SavedState {
    return {
      tabs: this.tabs,
      activeTabId: this._activeId,
    };
  }

  /** Restore tabs from a saved state — creates fresh shell processes. */
  restore(state: SavedState): void {
    for (const tab of state.tabs) {
      const id = this.createTerminal(tab.profileId, tab.cwd);
      // createTerminal assigns a new id; patch the title
      const instance = this.instances.get(id);
      if (instance && tab.title !== instance.title) {
        instance.setTitle(tab.title);
      }
    }
    // Activate the previously-active tab (by position, not by old id)
    if (state.activeTabId !== null && this.order.length > 0) {
      const oldTabs = state.tabs;
      const oldActiveIdx = oldTabs.findIndex((t) => t.id === state.activeTabId);
      if (oldActiveIdx >= 0 && oldActiveIdx < this.order.length) {
        this.setActive(this.order[oldActiveIdx]);
      }
    }
  }

  disposeAll(): void {
    for (const inst of this.instances.values()) {
      inst.dispose();
    }
    this.instances.clear();
    this.order = [];
    this._activeId = null;
  }

  private resolveDefaultCwd(): string {
    if (this.settings.cwdMode === "custom" && this.settings.customCwd) {
      return this.settings.customCwd;
    }
    return this.vaultPath;
  }
}
