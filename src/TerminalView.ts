import { ItemView, WorkspaceLeaf, Menu, Notice, setIcon } from "obsidian";
import { VIEW_TYPE_TERMINAL, PluginSettings, LayoutNode, SplitDirection } from "./types";
import { TerminalManager, TerminalGroup, paneIds } from "./TerminalManager";
import { PaneDirection } from "./TerminalInstance";
import { getTheme } from "./ThemeManager";
import { getAllProfiles } from "./ShellProfile";
import { RenameModal, ConfirmCloseModal, ConfirmModal } from "./modals";

type SplitNode = Extract<LayoutNode, { type: "split" }>;

// A pane can't be dragged smaller than this share of its split
const MIN_PANE_SHARE = 0.1;

export class TerminalView extends ItemView {
  private manager: TerminalManager;
  private tabBarEl: HTMLElement;
  private terminalContainerEl: HTMLElement;
  private layoutEl: HTMLElement; // the active tab's panes
  private parkingEl: HTMLElement; // hidden home for the terminals of other tabs
  private terminalContainers: Map<string, HTMLElement> = new Map();
  private renderedLayout: string | null = null; // shape layoutEl shows, so focus changes don't rebuild it

  // Search overlay (shared, controls the active terminal)
  private searchOverlayEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchVisible = false;

  // Drag-reorder state (tab ids)
  private dragSourceId: string | null = null;

  settings: PluginSettings;
  private vaultPath: string;

  // Exposed for main.ts to push tab-count updates to the status bar
  onTabCountChanged: ((count: number) => void) | null = null;

  // Set by main.ts so "Close panel" saves the session the same way the toggle command does
  onRequestClosePanel: (() => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    settings: PluginSettings,
    vaultPath: string,
    getInjectedEnv?: () => Record<string, string>
  ) {
    super(leaf);
    this.settings = settings;
    this.vaultPath = vaultPath;
    this.manager = new TerminalManager(settings, vaultPath, getInjectedEnv);
  }

  getViewType(): string {
    return VIEW_TYPE_TERMINAL;
  }

  getDisplayText(): string {
    return "Terminal";
  }

  getIcon(): string {
    return "terminal";
  }

  getManager(): TerminalManager {
    return this.manager;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("obsidian-terminal-panel");
    this.applyHeaderMode();

    this.tabBarEl = contentEl.createDiv({ cls: "terminal-tab-bar" });

    this.terminalContainerEl = contentEl.createDiv({
      cls: "terminal-render-area",
    });
    this.layoutEl = this.terminalContainerEl.createDiv({ cls: "terminal-layout" });
    this.parkingEl = this.terminalContainerEl.createDiv({ cls: "terminal-parking" });

    this.buildSearchOverlay();
    this.buildContextMenu();

    this.manager.onTabsChanged = () => {
      this.buildTabBar();
      this.onTabCountChanged?.(this.manager.count);
    };
    this.manager.onActiveChanged = () => this.syncLayout();
    this.manager.onLayoutChanged = () => this.syncLayout();

    // Restore previous session or create a fresh terminal
    const saved = this.settings.__session;
    if (this.settings.restoreTabs && saved && saved.tabs.length > 0) {
      this.manager.restore(saved);
    } else {
      this.manager.createTerminal();
    }

    this.syncLayout();
    this.onTabCountChanged?.(this.manager.count);
  }

  async onClose(): Promise<void> {
    this.manager.disposeAll();
    this.terminalContainers.clear();
    this.onTabCountChanged?.(0);
  }

  onResize(): void {
    for (const id of this.visiblePaneIds()) {
      this.manager.getInstance(id)?.fit();
    }
  }

  // ------ Tab bar ------

  // One VS Code-style header row: panel title, terminal tabs, then actions on the right.
  // A tab can hold several split panes; its label lists their titles, like a VS Code terminal group.
  private buildTabBar(): void {
    this.tabBarEl.empty();

    this.tabBarEl.createDiv({ cls: "terminal-panel-title", text: "Terminal" });

    const tabsWrapper = this.tabBarEl.createDiv({ cls: "terminal-tabs" });
    const profiles = getAllProfiles(this.settings.customProfiles);
    const activeGroup = this.manager.getActiveGroup();

    for (const group of this.manager.groups) {
      const tabEl = tabsWrapper.createDiv({
        cls: `terminal-tab ${group === activeGroup ? "is-active" : ""}`,
      });
      tabEl.dataset.groupId = group.id;
      tabEl.draggable = true;

      const iconEl = tabEl.createSpan({ cls: "terminal-tab-icon" });
      const focused = this.manager.getInstance(group.activePaneId);
      setIcon(
        iconEl,
        group.root.type === "split"
          ? this.splitIcon(group.root)
          : profiles.find((p) => p.id === focused?.profileId)?.icon ?? "terminal"
      );

      const labelEl = tabEl.createSpan({ cls: "terminal-tab-label" });
      labelEl.setText(this.groupTitle(group));

      const closeBtn = tabEl.createSpan({ cls: "terminal-tab-close" });
      setIcon(closeBtn, "x");
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.requestCloseGroup(group.id);
      });

      tabEl.addEventListener("click", () => {
        this.manager.setActive(group.activePaneId);
      });

      tabEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((item) =>
          item
            .setTitle("Rename")
            .setIcon("pencil")
            .onClick(() => this.renameTab(group.activePaneId))
        );
        menu.addItem((item) =>
          item
            .setTitle("Split right")
            .setIcon("columns-2")
            .onClick(() => this.splitActive("right", group.activePaneId))
        );
        menu.addItem((item) =>
          item
            .setTitle("Split down")
            .setIcon("rows-2")
            .onClick(() => this.splitActive("down", group.activePaneId))
        );
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle("Close")
            .setIcon("x")
            .onClick(() => this.requestCloseGroup(group.id))
        );
        menu.addItem((item) =>
          item
            .setTitle("Close others")
            .setIcon("x-circle")
            .onClick(() => this.closeOtherTabs(group.id))
        );
        menu.showAtMouseEvent(e);
      });

      // Drag-and-drop reorder
      tabEl.addEventListener("dragstart", (e) => {
        this.dragSourceId = group.id;
        tabEl.addClass("is-dragging");
        e.dataTransfer?.setData("text/plain", group.id);
      });

      tabEl.addEventListener("dragend", () => {
        tabEl.removeClass("is-dragging");
        this.dragSourceId = null;
        this.tabBarEl
          .querySelectorAll(".drag-over")
          .forEach((el) => el.removeClass("drag-over"));
      });

      tabEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (this.dragSourceId && this.dragSourceId !== group.id) {
          tabEl.addClass("drag-over");
        }
      });

      tabEl.addEventListener("dragleave", () => {
        tabEl.removeClass("drag-over");
      });

      tabEl.addEventListener("drop", (e) => {
        e.preventDefault();
        tabEl.removeClass("drag-over");
        if (this.dragSourceId && this.dragSourceId !== group.id) {
          this.manager.reorderTab(this.dragSourceId, group.id);
        }
      });
    }

    const actionsEl = this.tabBarEl.createDiv({ cls: "terminal-panel-actions" });

    const addBtn = this.addHeaderAction(actionsEl, "plus", "New terminal", () =>
      this.createNewTerminal()
    );
    addBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      this.showProfileMenu(e);
    });
    this.addHeaderAction(actionsEl, "chevron-down", "New terminal with profile…", (e) =>
      this.showProfileMenu(e)
    );
    this.addHeaderAction(actionsEl, "columns-2", "Split right", () => this.splitActive("right"));
    this.addHeaderAction(actionsEl, "rows-2", "Split down", () => this.splitActive("down"));
    this.addHeaderAction(actionsEl, "trash-2", "Kill terminal", () => this.closeActiveTab());
    this.addHeaderAction(actionsEl, "more-horizontal", "More actions", (e) =>
      this.showMoreMenu(e)
    );
  }

  private splitIcon(root: SplitNode): string {
    return root.axis === "column" ? "rows-2" : "columns-2";
  }

  private groupTitle(group: TerminalGroup): string {
    return paneIds(group.root)
      .map((id) => this.manager.getInstance(id)?.title || "Terminal")
      .join(", ");
  }

  private addHeaderAction(
    parent: HTMLElement,
    icon: string,
    label: string,
    onClick: (e: MouseEvent) => void
  ): HTMLElement {
    const btn = parent.createDiv({
      cls: "terminal-panel-action clickable-icon",
      attr: { "aria-label": label },
    });
    setIcon(btn, icon);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick(e);
    });
    return btn;
  }

  /** Open a menu under the button that was clicked, like a dropdown. */
  private showMenuBelow(menu: Menu, e: MouseEvent): void {
    const target = e.currentTarget instanceof HTMLElement ? e.currentTarget : null;
    if (!target) {
      menu.showAtMouseEvent(e);
      return;
    }
    const rect = target.getBoundingClientRect();
    menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  }

  private showProfileMenu(e: MouseEvent): void {
    const menu = new Menu();
    for (const p of getAllProfiles(this.settings.customProfiles)) {
      menu.addItem((item) =>
        item
          .setTitle(p.name)
          .setIcon(p.icon)
          .onClick(() => this.createNewTerminal(p.id))
      );
    }
    this.showMenuBelow(menu, e);
  }

  private showMoreMenu(e: MouseEvent): void {
    const activeId = this.manager.activeId;
    const activeGroup = this.manager.getActiveGroup();
    const menu = new Menu();
    if (activeId) {
      menu.addItem((item) =>
        item
          .setTitle("Rename terminal")
          .setIcon("pencil")
          .onClick(() => this.renameTab(activeId))
      );
      menu.addItem((item) =>
        item
          .setTitle("Clear terminal")
          .setIcon("eraser")
          .onClick(() => this.manager.getActiveInstance()?.clear())
      );
    }
    menu.addItem((item) =>
      item.setTitle("Find in terminal").setIcon("search").onClick(() => this.showSearch())
    );
    menu.addSeparator();
    if (activeGroup && this.manager.groups.length > 1) {
      menu.addItem((item) =>
        item
          .setTitle("Close other tabs")
          .setIcon("x-circle")
          .onClick(() => this.closeOtherTabs(activeGroup.id))
      );
    }
    menu.addItem((item) =>
      item.setTitle("Close panel").setIcon("x").onClick(() => this.requestClosePanel())
    );
    this.showMenuBelow(menu, e);
  }

  /** Closing the panel ends every shell in it, so ask first when any are running. */
  private requestClosePanel(): void {
    const close = (): void => {
      if (this.onRequestClosePanel) this.onRequestClosePanel();
      else this.leaf.detach();
    };
    const running = this.manager.tabs.filter(
      (t) => this.manager.getInstance(t.id)?.isRunning
    ).length;
    if (!this.settings.confirmOnClose || running === 0) {
      close();
      return;
    }
    const shells = running === 1 ? "the running shell" : `all ${running} running shells`;
    const after = this.settings.restoreTabs
      ? " The tabs come back, with new shells, the next time you open the terminal."
      : "";
    new ConfirmModal(
      this.app,
      "Close the terminal panel?",
      `This ends ${shells}.${after}`,
      "Close panel",
      close
    ).open();
  }

  /** Compact mode hides Obsidian's own tab and navigation header above the panel (see styles.css). */
  private applyHeaderMode(): void {
    this.containerEl.toggleClass("obsidian-terminal-compact", this.settings.compactHeader);
  }

  createNewTerminal(profileId?: string, cwd?: string): void {
    this.manager.createTerminal(profileId, cwd);
  }

  /** Split a pane (the focused one by default) to the right or downwards. */
  splitActive(direction: SplitDirection, paneId?: string): void {
    this.manager.splitTerminal(direction, paneId ?? this.manager.activeId);
  }

  /** Close one pane (a tab with a single pane closes with it). */
  private requestCloseTab(id: string): void {
    const instance = this.manager.getInstance(id);
    const title = instance?.title ?? "Terminal";
    if (this.settings.confirmOnClose && instance?.isRunning) {
      new ConfirmCloseModal(this.app, title, () => this.closeTab(id)).open();
    } else {
      this.closeTab(id);
    }
  }

  private closeTab(id: string): void {
    this.dropContainer(id);
    this.manager.closeTerminal(id);
    if (this.manager.count === 0) {
      this.manager.createTerminal();
    }
  }

  closeActiveTab(): void {
    if (this.manager.activeId) {
      this.requestCloseTab(this.manager.activeId);
    }
  }

  /** Close a whole tab, every pane in it. */
  private requestCloseGroup(groupId: string): void {
    const group = this.manager.groups.find((g) => g.id === groupId);
    if (!group) return;
    const running = paneIds(group.root).some((id) => this.manager.getInstance(id)?.isRunning);
    if (this.settings.confirmOnClose && running) {
      new ConfirmCloseModal(this.app, this.groupTitle(group), () => this.closeGroup(groupId)).open();
    } else {
      this.closeGroup(groupId);
    }
  }

  private closeGroup(groupId: string): void {
    const group = this.manager.groups.find((g) => g.id === groupId);
    if (!group) return;
    for (const id of paneIds(group.root)) {
      this.dropContainer(id);
    }
    this.manager.closeGroup(groupId);
    if (this.manager.count === 0) {
      this.manager.createTerminal();
    }
  }

  private closeOtherTabs(keepGroupId: string): void {
    for (const group of this.manager.groups.filter((g) => g.id !== keepGroupId)) {
      this.closeGroup(group.id);
    }
  }

  private renameTab(id: string): void {
    const instance = this.manager.getInstance(id);
    if (!instance) return;
    new RenameModal(this.app, instance.title, (newName) => {
      instance.setTitle(newName);
    }).open();
  }

  // ------ Panes ------

  private visiblePaneIds(): string[] {
    const group = this.manager.getActiveGroup();
    return group ? paneIds(group.root) : [];
  }

  /** Show the active tab's panes. The DOM is rebuilt only when the tab or the shape of its layout changes. */
  private syncLayout(): void {
    const group = this.manager.getActiveGroup();
    const shape = group ? `${group.id}:${this.shapeOf(group.root)}` : "";
    if (shape !== this.renderedLayout) {
      this.renderedLayout = shape;
      this.renderLayout(group);
    }

    const activeId = this.manager.activeId;
    this.layoutEl.querySelectorAll<HTMLElement>(".terminal-pane").forEach((pane) => {
      pane.toggleClass("is-focused", pane.dataset.termId === activeId);
    });
    this.buildTabBar();

    const active = this.manager.getActiveInstance();
    requestAnimationFrame(() => {
      for (const id of this.visiblePaneIds()) {
        this.manager.getInstance(id)?.fit();
      }
      active?.terminal.focus();
    });
  }

  private shapeOf(node: LayoutNode): string {
    return node.type === "pane"
      ? node.id
      : `${node.axis}(${node.children.map((c) => this.shapeOf(c)).join(",")})`;
  }

  private renderLayout(group: TerminalGroup | null): void {
    // Park every terminal first: the old layout's DOM is thrown away below
    for (const container of this.terminalContainers.values()) {
      this.parkingEl.appendChild(container);
    }
    this.layoutEl.empty();

    const visible = new Set<string>();
    if (group) {
      this.layoutEl.appendChild(this.renderNode(group.root, visible));
    }

    for (const { id } of this.manager.tabs) {
      const instance = this.manager.getInstance(id);
      if (!instance) continue;
      // Hidden terminals stop measuring; visible ones observe their (possibly new) pane
      instance.detach();
      if (!visible.has(id)) continue;

      instance.onSearchToggle = () => this.toggleSearch();
      instance.onSplitRequest = (direction) => this.splitActive(direction, id);
      instance.onFocusPaneRequest = (direction) => this.focusPaneToward(direction);

      const container = this.containerFor(id);
      if (instance.terminal.element) {
        instance.reattach(container);
      } else {
        instance.attach(container);
      }
    }
  }

  private renderNode(node: LayoutNode, visible: Set<string>): HTMLElement {
    if (node.type === "pane") {
      const pane = createDiv({ cls: "terminal-pane" });
      pane.dataset.termId = node.id;
      pane.appendChild(this.containerFor(node.id));
      visible.add(node.id);
      return pane;
    }
    const split = createDiv({ cls: `terminal-split mod-${node.axis}` });
    node.children.forEach((child, i) => {
      if (i > 0) split.appendChild(this.createSash(node, i - 1, split));
      const el = this.renderNode(child, visible);
      el.style.flex = `${node.sizes[i]} 1 0`;
      split.appendChild(el);
    });
    return split;
  }

  /** The element a terminal lives in. It moves between panes and the parking area; it's never re-created. */
  private containerFor(id: string): HTMLElement {
    let container = this.terminalContainers.get(id);
    if (!container) {
      container = this.parkingEl.createDiv({ cls: "terminal-instance-container" });
      container.dataset.termId = id;
      // Clicking into a pane focuses it
      container.addEventListener("focusin", () => {
        if (this.manager.activeId !== id) this.manager.setActive(id);
      });
      this.terminalContainers.set(id, container);
    }
    return container;
  }

  private dropContainer(id: string): void {
    this.terminalContainers.get(id)?.remove();
    this.terminalContainers.delete(id);
  }

  /**
   * The divider between two panes. Dragging it moves space between its neighbours; double-clicking
   * evens out the whole split. Sizes live in the layout, so they're saved with the session.
   */
  private createSash(node: SplitNode, index: number, splitEl: HTMLElement): HTMLElement {
    const row = node.axis === "row";
    const sash = createDiv({ cls: `terminal-sash mod-${node.axis}` });

    sash.addEventListener("pointerdown", (e: PointerEvent) => {
      const prev = sash.previousElementSibling as HTMLElement | null;
      const next = sash.nextElementSibling as HTMLElement | null;
      if (!prev || !next) return;
      e.preventDefault();
      try {
        sash.setPointerCapture(e.pointerId);
      } catch {
        // not a live pointer (e.g. a synthetic event): dragging still works while over the divider
      }
      sash.addClass("is-dragging");

      const rect = splitEl.getBoundingClientRect();
      const total = row ? rect.width : rect.height;
      const start = row ? e.clientX : e.clientY;
      const a = node.sizes[index];
      const b = node.sizes[index + 1];
      const min = Math.min(MIN_PANE_SHARE, (a + b) / 2);

      const onMove = (ev: PointerEvent): void => {
        const delta = ((row ? ev.clientX : ev.clientY) - start) / total;
        const sizeA = Math.min(a + b - min, Math.max(min, a + delta));
        node.sizes[index] = sizeA;
        node.sizes[index + 1] = a + b - sizeA;
        prev.style.flex = `${sizeA} 1 0`;
        next.style.flex = `${a + b - sizeA} 1 0`;
      };
      const onUp = (): void => {
        sash.removeEventListener("pointermove", onMove);
        sash.removeEventListener("pointerup", onUp);
        sash.removeEventListener("pointercancel", onUp);
        sash.removeClass("is-dragging");
        this.manager.getActiveInstance()?.terminal.focus();
      };
      sash.addEventListener("pointermove", onMove);
      sash.addEventListener("pointerup", onUp);
      sash.addEventListener("pointercancel", onUp);
    });

    sash.addEventListener("dblclick", () => {
      node.sizes = node.sizes.map(() => 1 / node.sizes.length);
      let i = 0;
      for (const child of Array.from(splitEl.children) as HTMLElement[]) {
        if (child.hasClass("terminal-sash")) continue;
        child.style.flex = `${node.sizes[i++]} 1 0`;
      }
    });

    return sash;
  }

  /** Move focus to the nearest pane in a direction (⌥⌘ + arrow). */
  private focusPaneToward(direction: PaneDirection): void {
    const activeId = this.manager.activeId;
    const panes = Array.from(this.layoutEl.querySelectorAll<HTMLElement>(".terminal-pane"));
    const from = panes.find((p) => p.dataset.termId === activeId)?.getBoundingClientRect();
    if (!from) return;
    const horizontal = direction === "left" || direction === "right";
    const cx = from.left + from.width / 2;
    const cy = from.top + from.height / 2;

    let best: { id: string; score: number } | null = null;
    for (const pane of panes) {
      const id = pane.dataset.termId;
      if (!id || id === activeId) continue;
      const r = pane.getBoundingClientRect();
      // Distance from our edge to the pane's near edge in that direction; negative = not that way
      const ahead =
        direction === "left" ? from.left - r.right
        : direction === "right" ? r.left - from.right
        : direction === "up" ? from.top - r.bottom
        : r.top - from.bottom;
      if (ahead < -2) continue;
      const across = horizontal
        ? Math.abs(r.top + r.height / 2 - cy)
        : Math.abs(r.left + r.width / 2 - cx);
      const score = ahead + across * 2;
      if (!best || score < best.score) best = { id, score };
    }
    if (best) this.manager.setActive(best.id);
  }

  // ------ Search overlay ------

  private buildSearchOverlay(): void {
    const overlay = this.terminalContainerEl.createDiv({
      cls: "terminal-search-overlay",
    });
    overlay.style.display = "none";
    this.searchOverlayEl = overlay;

    this.searchInputEl = overlay.createEl("input", {
      type: "text",
      placeholder: "Search…",
      cls: "terminal-search-input",
    });

    this.searchInputEl.addEventListener("input", () => {
      this.runSearch(true);
    });

    this.searchInputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.shiftKey ? this.searchPrev() : this.searchNext();
      } else if (e.key === "Escape") {
        this.hideSearch();
      }
    });

    const prevBtn = overlay.createEl("button", {
      cls: "terminal-search-btn",
      attr: { "aria-label": "Previous match" },
    });
    setIcon(prevBtn, "chevron-up");
    prevBtn.addEventListener("click", () => this.searchPrev());

    const nextBtn = overlay.createEl("button", {
      cls: "terminal-search-btn",
      attr: { "aria-label": "Next match" },
    });
    setIcon(nextBtn, "chevron-down");
    nextBtn.addEventListener("click", () => this.searchNext());

    const closeBtn = overlay.createEl("button", {
      cls: "terminal-search-btn",
      attr: { "aria-label": "Close search" },
    });
    setIcon(closeBtn, "x");
    closeBtn.addEventListener("click", () => this.hideSearch());
  }

  toggleSearch(): void {
    if (this.searchVisible) {
      this.hideSearch();
    } else {
      this.showSearch();
    }
  }

  showSearch(): void {
    if (!this.searchOverlayEl) return;
    this.searchVisible = true;
    this.searchOverlayEl.style.display = "";
    this.searchInputEl?.focus();
    this.searchInputEl?.select();
  }

  hideSearch(): void {
    if (!this.searchOverlayEl) return;
    this.searchVisible = false;
    this.searchOverlayEl.style.display = "none";
    this.manager.getActiveInstance()?.terminal.focus();
  }

  private runSearch(incremental = false): void {
    const term = this.searchInputEl?.value ?? "";
    if (!term) {
      this.manager.getActiveInstance()?.searchAddon.clearDecorations();
      return;
    }
    const inst = this.manager.getActiveInstance();
    if (!inst) return;
    inst.searchAddon.findNext(term, {
      incremental,
      caseSensitive: false,
      decorations: {
        matchBackground: "#ffff0040",
        matchBorder: "#ffff00",
        matchOverviewRuler: "#ffff00",
        activeMatchBackground: "#ff8c0060",
        activeMatchBorder: "#ff8c00",
        activeMatchColorOverviewRuler: "#ff8c00",
      },
    });
  }

  private searchNext(): void {
    const term = this.searchInputEl?.value ?? "";
    if (!term) return;
    const inst = this.manager.getActiveInstance();
    if (!inst) return;
    inst.searchAddon.findNext(term, {
      caseSensitive: false,
      decorations: {
        matchBackground: "#ffff0040",
        matchBorder: "#ffff00",
        matchOverviewRuler: "#ffff00",
        activeMatchBackground: "#ff8c0060",
        activeMatchBorder: "#ff8c00",
        activeMatchColorOverviewRuler: "#ff8c00",
      },
    });
  }

  private searchPrev(): void {
    const term = this.searchInputEl?.value ?? "";
    if (!term) return;
    const inst = this.manager.getActiveInstance();
    if (!inst) return;
    inst.searchAddon.findPrevious(term, {
      caseSensitive: false,
      decorations: {
        matchBackground: "#ffff0040",
        matchBorder: "#ffff00",
        matchOverviewRuler: "#ffff00",
        activeMatchBackground: "#ff8c0060",
        activeMatchBorder: "#ff8c00",
        activeMatchColorOverviewRuler: "#ff8c00",
      },
    });
  }

  // ------ Right-click context menu on terminal body ------

  private buildContextMenu(): void {
    this.terminalContainerEl.addEventListener("contextmenu", (e) => {
      const target = e.target as HTMLElement;
      // Only intercept right-clicks inside a terminal canvas/viewport, not the tab bar
      const isInTerminal = target.closest(".xterm") !== null;
      if (!isInTerminal) return;

      e.preventDefault();
      // Act on the pane that was right-clicked, not whichever had focus
      const paneId = target.closest<HTMLElement>(".terminal-instance-container")?.dataset.termId;
      if (paneId && paneId !== this.manager.activeId) this.manager.setActive(paneId);
      const inst = this.manager.getActiveInstance();
      if (!inst) return;

      const menu = new Menu();
      const hasSel = inst.terminal.getSelection().length > 0;

      if (hasSel) {
        menu.addItem((item) =>
          item.setTitle("Copy").setIcon("copy").onClick(() => {
            navigator.clipboard.writeText(inst.terminal.getSelection()).catch(() => {
              new Notice("Could not access clipboard.");
            });
          })
        );
      }

      menu.addItem((item) =>
        item.setTitle("Paste").setIcon("clipboard").onClick(() => {
          navigator.clipboard.readText().then((text) => {
            if (!text) return;
            if (this.settings.pasteSanitize && text.includes("\n")) {
              new Notice("Paste contains newlines — pasting now.", 3000);
            }
            inst.terminal.paste(text);
          }).catch(() => {
            new Notice("Could not access clipboard.");
          });
        })
      );

      menu.addItem((item) =>
        item.setTitle("Clear").setIcon("eraser").onClick(() => inst.clear())
      );

      menu.addItem((item) =>
        item.setTitle("Search").setIcon("search").onClick(() => this.showSearch())
      );

      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("Split right").setIcon("columns-2").onClick(() => this.splitActive("right", inst.id))
      );
      menu.addItem((item) =>
        item.setTitle("Split down").setIcon("rows-2").onClick(() => this.splitActive("down", inst.id))
      );
      if (this.visiblePaneIds().length > 1) {
        menu.addItem((item) =>
          item.setTitle("Close pane").setIcon("x").onClick(() => this.requestCloseTab(inst.id))
        );
      }

      menu.showAtMouseEvent(e);
    });
  }

  // ------ Public API ------

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.manager.updateSettings(settings);
    this.applyHeaderMode();

    const theme = getTheme(
      settings.activeThemeId,
      settings.customThemes
    );
    this.manager.applyTheme(theme);
    this.manager.applyFont(settings.fontFamily, settings.fontSize);
  }

  refreshTheme(): void {
    const theme = getTheme(
      this.settings.activeThemeId,
      this.settings.customThemes
    );
    this.manager.applyTheme(theme);
  }

  /** Serialize current session for persistence. Called by main.ts on tabs-changed. */
  serializeSession(): void {
    this.settings.__session = this.manager.serialize();
  }
}
