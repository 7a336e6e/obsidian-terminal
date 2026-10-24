import { ITheme } from "@xterm/xterm";
import { TerminalInstance } from "./TerminalInstance";
import {
  PluginSettings,
  TerminalTab,
  SavedState,
  LayoutNode,
  SplitDirection,
} from "./types";
import { getProfile } from "./ShellProfile";
import { getTheme } from "./ThemeManager";

let idCounter = 0;

function nextId(prefix = "term"): string {
  return `${prefix}-${Date.now()}-${++idCounter}`;
}

/** One tab in the tab bar: a layout of one or more panes, each running its own terminal instance. */
export interface TerminalGroup {
  id: string;
  root: LayoutNode;
  activePaneId: string; // the pane that gets focus when this tab is shown
}

/** Pane ids of a layout, in reading order (left to right, top to bottom). */
export function paneIds(node: LayoutNode): string[] {
  return node.type === "pane" ? [node.id] : node.children.flatMap(paneIds);
}

/** Split pane `targetId`, putting pane `newId` after it along `axis`. Returns the (possibly new) root. */
function splitNode(
  node: LayoutNode,
  targetId: string,
  newId: string,
  axis: "row" | "column"
): LayoutNode {
  if (node.type === "pane") {
    if (node.id !== targetId) return node;
    return {
      type: "split",
      axis,
      children: [node, { type: "pane", id: newId }],
      sizes: [0.5, 0.5],
    };
  }
  const idx = node.children.findIndex((c) => c.type === "pane" && c.id === targetId);
  if (idx >= 0 && node.axis === axis) {
    // Same direction as this split: the new pane shares the target's space instead of nesting
    const half = node.sizes[idx] / 2;
    node.children.splice(idx + 1, 0, { type: "pane", id: newId });
    node.sizes.splice(idx, 1, half, half);
    return node;
  }
  node.children = node.children.map((c) => splitNode(c, targetId, newId, axis));
  return node;
}

/** Remove a pane. A split left with one child collapses into it; returns null when nothing is left. */
function removeNode(node: LayoutNode, id: string): LayoutNode | null {
  if (node.type === "pane") return node.id === id ? null : node;
  return collapse(node, node.children.map((c) => removeNode(c, id)));
}

/**
 * Copy a saved layout, renaming pane ids. Panes without a new name (or seen twice) are dropped, and
 * anything malformed is ignored, since the layout comes from the settings file.
 */
function renameNode(node: unknown, rename: Map<string, string>, used: Set<string>): LayoutNode | null {
  if (!node || typeof node !== "object") return null;
  const n = node as { type?: unknown; id?: unknown; axis?: unknown; children?: unknown; sizes?: unknown };
  if (n.type === "pane") {
    const id = typeof n.id === "string" ? rename.get(n.id) : undefined;
    if (!id || used.has(id)) return null;
    used.add(id);
    return { type: "pane", id };
  }
  if (n.type !== "split" || (n.axis !== "row" && n.axis !== "column") || !Array.isArray(n.children)) {
    return null;
  }
  const children: unknown[] = n.children;
  const sizes = Array.isArray(n.sizes) && n.sizes.length === children.length
    ? n.sizes.map((s: unknown) => (typeof s === "number" && s > 0 ? s : 1))
    : children.map(() => 1);
  const split: Extract<LayoutNode, { type: "split" }> = {
    type: "split",
    axis: n.axis,
    children: [],
    sizes,
  };
  return collapse(split, children.map((c) => renameNode(c, rename, used)));
}

/** Replace a split's children with `kept` (null = removed), renormalising sizes and collapsing if needed. */
function collapse(
  split: Extract<LayoutNode, { type: "split" }>,
  kept: (LayoutNode | null)[]
): LayoutNode | null {
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  kept.forEach((child, i) => {
    if (child) {
      children.push(child);
      sizes.push(split.sizes[i] ?? 1);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  const total = sizes.reduce((a, b) => a + b, 0);
  split.children = children;
  split.sizes = sizes.map((s) => s / total);
  return split;
}

export class TerminalManager {
  private instances: Map<string, TerminalInstance> = new Map();
  private groupList: TerminalGroup[] = []; // tab order, changed by drag-reorder
  private _activeId: string | null = null; // the focused pane

  onTabsChanged: (() => void) | null = null;
  onActiveChanged: ((id: string | null) => void) | null = null;
  /** Panes were added to or removed from a tab. */
  onLayoutChanged: (() => void) | null = null;

  constructor(
    private settings: PluginSettings,
    private vaultPath: string,
    private getInjectedEnv?: () => Record<string, string>
  ) {}

  get activeId(): string | null {
    return this._activeId;
  }

  /** Every terminal, tab by tab, panes in reading order. */
  get tabs(): TerminalTab[] {
    return this.groupList
      .flatMap((g) => paneIds(g.root))
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

  get groups(): TerminalGroup[] {
    return this.groupList;
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

  getActiveGroup(): TerminalGroup | null {
    return this._activeId ? this.groupOf(this._activeId) : null;
  }

  groupOf(paneId: string): TerminalGroup | null {
    return this.groupList.find((g) => paneIds(g.root).includes(paneId)) ?? null;
  }

  /** Open a terminal in a new tab. */
  createTerminal(
    profileId?: string,
    cwd?: string,
    containerEl?: HTMLElement
  ): string {
    const id = this.spawnInstance(profileId, cwd);
    this.groupList.push({ id: nextId("group"), root: { type: "pane", id }, activePaneId: id });
    this._activeId = id;

    this.onTabsChanged?.();
    this.onActiveChanged?.(id);

    return id;
  }

  /**
   * Split a pane (the focused one by default), like VS Code. The new terminal starts with the same
   * profile and working directory as the pane it was split from.
   */
  splitTerminal(direction: SplitDirection, targetId: string | null = this._activeId): string | null {
    const target = targetId ? this.instances.get(targetId) : undefined;
    const group = targetId ? this.groupOf(targetId) : null;
    if (!targetId || !target || !group) return null;

    const id = this.spawnInstance(target.profileId, target.cwd);
    group.root = splitNode(group.root, targetId, id, direction === "right" ? "row" : "column");
    group.activePaneId = id;
    this._activeId = id;

    this.onLayoutChanged?.();
    this.onTabsChanged?.();
    this.onActiveChanged?.(id);
    return id;
  }

  /** Close one pane. A tab whose last pane closes disappears. */
  closeTerminal(id: string): void {
    const instance = this.instances.get(id);
    if (!instance) return;

    const group = this.groupOf(id);
    instance.dispose();
    this.instances.delete(id);

    if (group) {
      const before = paneIds(group.root);
      const root = removeNode(group.root, id);
      if (root) {
        group.root = root;
        if (group.activePaneId === id) {
          // Focus the pane before the closed one, like VS Code
          const after = paneIds(root);
          group.activePaneId = after[Math.max(0, before.indexOf(id) - 1)] ?? after[0];
        }
      } else {
        this.groupList = this.groupList.filter((g) => g !== group);
      }
    }

    if (this._activeId === id) {
      const sameTab = group && this.groupList.includes(group) ? group.activePaneId : null;
      const lastTab = this.groupList[this.groupList.length - 1];
      this._activeId = sameTab ?? lastTab?.activePaneId ?? null;
    }

    this.onLayoutChanged?.();
    this.onActiveChanged?.(this._activeId);
    this.onTabsChanged?.();
  }

  /** Close a tab and every pane in it. */
  closeGroup(groupId: string): void {
    const group = this.groupList.find((g) => g.id === groupId);
    if (!group) return;
    for (const id of paneIds(group.root)) {
      this.instances.get(id)?.dispose();
      this.instances.delete(id);
    }
    this.groupList = this.groupList.filter((g) => g !== group);

    if (this._activeId && !this.instances.has(this._activeId)) {
      this._activeId = this.groupList[this.groupList.length - 1]?.activePaneId ?? null;
    }

    this.onLayoutChanged?.();
    this.onActiveChanged?.(this._activeId);
    this.onTabsChanged?.();
  }

  setActive(id: string): void {
    if (!this.instances.has(id)) return;
    const group = this.groupOf(id);
    if (group) group.activePaneId = id;
    this._activeId = id;
    this.onActiveChanged?.(id);
  }

  /** Next / previous tab. */
  cycleTab(direction: 1 | -1): void {
    if (this.groupList.length <= 1) return;
    const current = this.getActiveGroup();
    const currentIdx = current ? this.groupList.indexOf(current) : 0;
    const nextIdx = (currentIdx + direction + this.groupList.length) % this.groupList.length;
    this.setActive(this.groupList[nextIdx].activePaneId);
  }

  /** Next / previous pane within the current tab. */
  focusPane(direction: 1 | -1): void {
    const group = this.getActiveGroup();
    if (!group || !this._activeId) return;
    const ids = paneIds(group.root);
    if (ids.length <= 1) return;
    const idx = ids.indexOf(this._activeId);
    this.setActive(ids[(idx + direction + ids.length) % ids.length]);
  }

  /** Move a tab to a new position (drag-reorder). Ids are tab (group) ids. */
  reorderTab(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const fromIdx = this.groupList.findIndex((g) => g.id === fromId);
    const toIdx = this.groupList.findIndex((g) => g.id === toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = this.groupList.splice(fromIdx, 1);
    this.groupList.splice(toIdx, 0, moved);
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

  /** Serialize current tab state (including split layouts and pane sizes) for session persistence. */
  serialize(): SavedState {
    return {
      tabs: this.tabs,
      activeTabId: this._activeId,
      groups: this.groupList.map((g) => ({
        root: JSON.parse(JSON.stringify(g.root)) as LayoutNode,
        activeTabId: g.activePaneId,
      })),
    };
  }

  /**
   * Restore tabs from a saved state — creates fresh shell processes. Emits no events: the view renders
   * once afterwards.
   */
  restore(state: SavedState): void {
    const rename = new Map<string, string>();
    for (const tab of state.tabs) {
      const id = this.spawnInstance(tab.profileId, tab.cwd);
      // spawnInstance assigns a new id; patch the title
      const instance = this.instances.get(id);
      if (instance && tab.title && tab.title !== instance.title) {
        instance.setTitle(tab.title);
      }
      rename.set(tab.id, id);
    }

    const used = new Set<string>();
    for (const saved of state.groups ?? []) {
      const root = renameNode(saved?.root, rename, used);
      if (!root) continue;
      const ids = paneIds(root);
      const active = rename.get(saved.activeTabId ?? "");
      this.groupList.push({
        id: nextId("group"),
        root,
        activePaneId: active && ids.includes(active) ? active : ids[0],
      });
    }
    // Terminals no saved layout mentions (e.g. sessions from before splits) get a tab each
    for (const id of rename.values()) {
      if (!used.has(id)) {
        this.groupList.push({ id: nextId("group"), root: { type: "pane", id }, activePaneId: id });
      }
    }

    const active = rename.get(state.activeTabId ?? "");
    this._activeId = active ?? this.groupList[0]?.activePaneId ?? null;
    const group = this._activeId ? this.groupOf(this._activeId) : null;
    if (group && this._activeId) group.activePaneId = this._activeId;
  }

  disposeAll(): void {
    for (const inst of this.instances.values()) {
      inst.dispose();
    }
    this.instances.clear();
    this.groupList = [];
    this._activeId = null;
  }

  /** Create a terminal instance without placing it in a tab. */
  private spawnInstance(profileId?: string, cwd?: string): string {
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
    return id;
  }

  private resolveDefaultCwd(): string {
    if (this.settings.cwdMode === "custom" && this.settings.customCwd) {
      return this.settings.customCwd;
    }
    return this.vaultPath;
  }
}
