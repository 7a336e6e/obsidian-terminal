import { ItemView, WorkspaceLeaf, Menu, setIcon } from "obsidian";
import { VIEW_TYPE_TERMINAL, PluginSettings } from "./types";
import { TerminalManager } from "./TerminalManager";
import { TerminalInstance } from "./TerminalInstance";
import { getTheme } from "./ThemeManager";
import { getAllProfiles } from "./ShellProfile";

export class TerminalView extends ItemView {
  private manager: TerminalManager;
  private tabBarEl: HTMLElement;
  private terminalContainerEl: HTMLElement;
  private activeContainerEl: HTMLElement | null = null;
  private terminalContainers: Map<string, HTMLElement> = new Map();

  settings: PluginSettings;
  private vaultPath: string;

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

    // Tab bar
    this.tabBarEl = contentEl.createDiv({ cls: "terminal-tab-bar" });
    this.buildTabBar();

    // Terminal render area
    this.terminalContainerEl = contentEl.createDiv({
      cls: "terminal-render-area",
    });

    // Wire up manager callbacks
    this.manager.onTabsChanged = () => this.buildTabBar();
    this.manager.onActiveChanged = (id) => this.showTerminal(id);

    // Create initial terminal
    const id = this.manager.createTerminal();
    this.createTerminalContainer(id);
    this.showTerminal(id);
  }

  async onClose(): Promise<void> {
    this.manager.disposeAll();
    this.terminalContainers.clear();
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

      const labelEl = tabEl.createSpan({ cls: "terminal-tab-label" });
      labelEl.setText(tab.title || "Terminal");

      const closeBtn = tabEl.createSpan({ cls: "terminal-tab-close" });
      setIcon(closeBtn, "x");
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(tab.id);
      });

      tabEl.addEventListener("click", () => {
        this.manager.setActive(tab.id);
      });

      // Right-click context menu
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
            .onClick(() => this.closeTab(tab.id))
        );
        menu.addItem((item) =>
          item
            .setTitle("Close others")
            .setIcon("x-circle")
            .onClick(() => this.closeOtherTabs(tab.id))
        );
        menu.showAtMouseEvent(e);
      });
    }

    // Add new terminal button with profile dropdown
    const addBtn = this.tabBarEl.createDiv({ cls: "terminal-tab-add" });
    setIcon(addBtn, "plus");
    addBtn.setAttribute("aria-label", "New terminal");
    addBtn.addEventListener("click", () => {
      this.createNewTerminal();
    });

    // Profile dropdown on right-click of "+"
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

  private closeTab(id: string): void {
    const container = this.terminalContainers.get(id);
    if (container) {
      container.remove();
      this.terminalContainers.delete(id);
    }
    this.manager.closeTerminal(id);

    // If no terminals left, create a fresh one
    if (this.manager.count === 0) {
      const newId = this.manager.createTerminal();
      this.createTerminalContainer(newId);
      this.showTerminal(newId);
    } else if (this.manager.activeId) {
      this.showTerminal(this.manager.activeId);
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

    // Simple prompt — Obsidian doesn't have a built-in input modal, so use browser prompt
    const newName = window.prompt("Rename terminal:", instance.title);
    if (newName !== null && newName.trim()) {
      (instance as any)._title = newName.trim();
      this.manager.onTabsChanged?.();
    }
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

    // Hide all containers
    for (const [cId, cont] of this.terminalContainers) {
      cont.style.display = "none";
      if (cId !== id) {
        this.manager.getInstance(cId)?.detach();
      }
    }

    // Show the active container
    const container = this.terminalContainers.get(id);
    if (!container) return;
    container.style.display = "";

    const instance = this.manager.getInstance(id);
    if (!instance) return;

    // Attach or reattach the terminal to this container
    if (!instance.terminal.element || !container.contains(instance.terminal.element)) {
      if (instance.terminal.element) {
        instance.reattach(container);
      } else {
        instance.attach(container);
      }
    } else {
      instance.reattach(container);
    }

    this.activeContainerEl = container;
    this.buildTabBar();

    // Focus the terminal
    requestAnimationFrame(() => {
      instance.terminal.focus();
      instance.fit();
    });
  }

  // ------ Public API ------

  updateSettings(settings: PluginSettings): void {
    this.settings = settings;
    this.manager.updateSettings(settings);

    // Reapply theme
    const theme = getTheme(
      settings.activeThemeId,
      settings.customThemes
    );
    this.manager.applyTheme(theme);

    // Reapply font
    this.manager.applyFont(settings.fontFamily, settings.fontSize);
  }

  refreshTheme(): void {
    const theme = getTheme(
      this.settings.activeThemeId,
      this.settings.customThemes
    );
    this.manager.applyTheme(theme);
  }
}
