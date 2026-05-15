import { ItemView, WorkspaceLeaf, Menu, Notice, setIcon } from "obsidian";
import { VIEW_TYPE_TERMINAL, PluginSettings } from "./types";
import { TerminalManager } from "./TerminalManager";
import { getTheme } from "./ThemeManager";
import { getAllProfiles } from "./ShellProfile";
import { RenameModal, ConfirmCloseModal } from "./modals";

export class TerminalView extends ItemView {
  private manager: TerminalManager;
  private tabBarEl: HTMLElement;
  private terminalContainerEl: HTMLElement;
  private terminalContainers: Map<string, HTMLElement> = new Map();

  // Search overlay (shared, controls the active terminal)
  private searchOverlayEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchVisible = false;

  // Drag-reorder state
  private dragSourceId: string | null = null;

  settings: PluginSettings;
  private vaultPath: string;

  // Exposed for main.ts to push tab-count updates to the status bar
  onTabCountChanged: ((count: number) => void) | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    settings: PluginSettings,
    vaultPath: string
  ) {
    super(leaf);
    this.settings = settings;
    this.vaultPath = vaultPath;
    this.manager = new TerminalManager(settings, vaultPath);
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

    this.tabBarEl = contentEl.createDiv({ cls: "terminal-tab-bar" });

    this.terminalContainerEl = contentEl.createDiv({
      cls: "terminal-render-area",
    });

    this.buildSearchOverlay();
    this.buildContextMenu();

    this.manager.onTabsChanged = () => {
      this.buildTabBar();
      this.onTabCountChanged?.(this.manager.count);
    };
    this.manager.onActiveChanged = (id) => this.showTerminal(id);

    // Restore previous session or create a fresh terminal
    const saved = this.settings.__session;
    if (this.settings.restoreTabs && saved && saved.tabs.length > 0) {
      this.manager.restore(saved);
      for (const tab of this.manager.tabs) {
        this.createTerminalContainer(tab.id);
      }
      const activeId = this.manager.activeId;
      if (activeId) this.showTerminal(activeId);
    } else {
      const id = this.manager.createTerminal();
      this.createTerminalContainer(id);
      this.showTerminal(id);
    }

    this.buildTabBar();
    this.onTabCountChanged?.(this.manager.count);
  }

  async onClose(): Promise<void> {
    this.manager.disposeAll();
    this.terminalContainers.clear();
    this.onTabCountChanged?.(0);
  }

  onResize(): void {
    const active = this.manager.getActiveInstance();
    active?.fit();
  }

  // ------ Tab bar ------

  private buildTabBar(): void {
    this.tabBarEl.empty();

    const tabsWrapper = this.tabBarEl.createDiv({ cls: "terminal-tabs" });

    for (const tab of this.manager.tabs) {
      const tabEl = tabsWrapper.createDiv({
        cls: `terminal-tab ${tab.id === this.manager.activeId ? "is-active" : ""}`,
      });
      tabEl.dataset.termId = tab.id;
      tabEl.draggable = true;

      const labelEl = tabEl.createSpan({ cls: "terminal-tab-label" });
      labelEl.setText(tab.title || "Terminal");

      const closeBtn = tabEl.createSpan({ cls: "terminal-tab-close" });
      setIcon(closeBtn, "x");
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.requestCloseTab(tab.id);
      });

      tabEl.addEventListener("click", () => {
        this.manager.setActive(tab.id);
      });

      tabEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const menu = new Menu();
        menu.addItem((item) =>
          item
            .setTitle("Rename")
            .setIcon("pencil")
            .onClick(() => this.renameTab(tab.id))
        );
        menu.addItem((item) =>
          item
            .setTitle("Close")
            .setIcon("x")
            .onClick(() => this.requestCloseTab(tab.id))
        );
        menu.addItem((item) =>
          item
            .setTitle("Close others")
            .setIcon("x-circle")
            .onClick(() => this.closeOtherTabs(tab.id))
        );
        menu.showAtMouseEvent(e);
      });

      // Drag-and-drop reorder
      tabEl.addEventListener("dragstart", (e) => {
        this.dragSourceId = tab.id;
        tabEl.addClass("is-dragging");
        e.dataTransfer?.setData("text/plain", tab.id);
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
        if (this.dragSourceId && this.dragSourceId !== tab.id) {
          tabEl.addClass("drag-over");
        }
      });

      tabEl.addEventListener("dragleave", () => {
        tabEl.removeClass("drag-over");
      });

      tabEl.addEventListener("drop", (e) => {
        e.preventDefault();
        tabEl.removeClass("drag-over");
        if (this.dragSourceId && this.dragSourceId !== tab.id) {
          this.manager.reorderTab(this.dragSourceId, tab.id);
        }
      });
    }

    const addBtn = this.tabBarEl.createDiv({ cls: "terminal-tab-add" });
    setIcon(addBtn, "plus");
    addBtn.setAttribute("aria-label", "New terminal");
    addBtn.addEventListener("click", () => {
      this.createNewTerminal();
    });

    addBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const menu = new Menu();
      const profiles = getAllProfiles(this.settings.customProfiles);
      for (const p of profiles) {
        menu.addItem((item) =>
          item
            .setTitle(p.name)
            .setIcon(p.icon)
            .onClick(() => this.createNewTerminal(p.id))
        );
      }
      menu.showAtMouseEvent(e);
    });
  }

  createNewTerminal(profileId?: string, cwd?: string): void {
    const id = this.manager.createTerminal(profileId, cwd);
    this.createTerminalContainer(id);
    this.showTerminal(id);
  }

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
    const container = this.terminalContainers.get(id);
    if (container) {
      container.remove();
      this.terminalContainers.delete(id);
    }
    this.manager.closeTerminal(id);

    if (this.manager.count === 0) {
      const newId = this.manager.createTerminal();
      this.createTerminalContainer(newId);
      this.showTerminal(newId);
    } else if (this.manager.activeId) {
      this.showTerminal(this.manager.activeId);
    }
  }

  closeActiveTab(): void {
    if (this.manager.activeId) {
      this.requestCloseTab(this.manager.activeId);
    }
  }

  private closeOtherTabs(keepId: string): void {
    const ids = this.manager.tabs.map((t) => t.id).filter((id) => id !== keepId);
    for (const id of ids) {
      const container = this.terminalContainers.get(id);
      if (container) {
        container.remove();
        this.terminalContainers.delete(id);
      }
      this.manager.closeTerminal(id);
    }
  }

  private renameTab(id: string): void {
    const instance = this.manager.getInstance(id);
    if (!instance) return;
    new RenameModal(this.app, instance.title, (newName) => {
      instance.setTitle(newName);
    }).open();
  }

  // ------ Terminal container management ------

  private createTerminalContainer(id: string): void {
    const container = this.terminalContainerEl.createDiv({
      cls: "terminal-instance-container",
    });
    container.dataset.termId = id;
    container.style.display = "none";
    this.terminalContainers.set(id, container);
  }

  private showTerminal(id: string | null): void {
    if (!id) return;

    for (const [cId, cont] of this.terminalContainers) {
      cont.style.display = "none";
      if (cId !== id) {
        this.manager.getInstance(cId)?.detach();
      }
    }

    const container = this.terminalContainers.get(id);
    if (!container) return;
    container.style.display = "";

    const instance = this.manager.getInstance(id);
    if (!instance) return;

    // Wire up search toggle callback for this instance
    instance.onSearchToggle = () => this.toggleSearch();

    if (!instance.terminal.element || !container.contains(instance.terminal.element)) {
      if (instance.terminal.element) {
        instance.reattach(container);
      } else {
        instance.attach(container);
      }
    } else {
      instance.reattach(container);
    }

    this.buildTabBar();

    requestAnimationFrame(() => {
      instance.terminal.focus();
      instance.fit();
    });
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

      menu.showAtMouseEvent(e);
    });
  }

  // ------ Public API ------

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.manager.updateSettings(settings);

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
