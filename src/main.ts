import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  normalizePath,
} from "obsidian";
import {
  VIEW_TYPE_TERMINAL,
  PluginSettings,
  DEFAULT_SETTINGS,
} from "./types";
import { TerminalView } from "./TerminalView";
import { TerminalSettingTab } from "./settings";
import * as path from "path";

export default class ObsidianTerminalPlugin extends Plugin {
  settings: PluginSettings;
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Register the terminal view
    this.registerView(VIEW_TYPE_TERMINAL, (leaf) => {
      return new TerminalView(leaf, this.settings, this.getVaultBasePath());
    });

    // Ribbon icon
    this.addRibbonIcon("terminal", "Open terminal", () => {
      this.activateView();
    });

    // Commands
    this.addCommand({
      id: "open-terminal",
      name: "Open terminal",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "toggle-terminal",
      name: "Toggle terminal panel",
      callback: () => this.toggleView(),
    });

    this.addCommand({
      id: "new-terminal",
      name: "New terminal tab",
      callback: () => this.newTerminalTab(),
    });

    this.addCommand({
      id: "next-terminal",
      name: "Next terminal tab",
      callback: () => this.cycleTerminal(1),
    });

    this.addCommand({
      id: "prev-terminal",
      name: "Previous terminal tab",
      callback: () => this.cycleTerminal(-1),
    });

    this.addCommand({
      id: "terminal-here",
      name: "Open terminal in current note's folder",
      callback: () => this.openTerminalHere(),
    });

    // Settings tab
    this.addSettingTab(new TerminalSettingTab(this.app, this));

    // Status bar item
    this.statusBarEl = this.addStatusBarItem();
    this.statusBarEl.setText("Terminal");
    this.statusBarEl.addClass("obsidian-terminal-statusbar");
    this.statusBarEl.addEventListener("click", () => this.toggleView());

    // Listen for theme changes to refresh terminal colors
    this.registerEvent(
      // @ts-ignore - css-change is a valid event
      this.app.workspace.on("css-change", () => {
        this.refreshTerminalTheme();
      })
    );

    // Listen for active file changes for CWD sync
    this.registerEvent(
      this.app.workspace.on("file-open", (file: TFile | null) => {
        if (
          file &&
          this.settings.cwdMode === "active-note"
        ) {
          const folderPath = this.resolveFileFolderPath(file);
          if (folderPath) {
            const view = this.getTerminalView();
            view?.getManager().cdActive(folderPath);
          }
        }
      })
    );
  }

  async onunload(): Promise<void> {
    // Detach all terminal leaves — this triggers onClose on each view, which disposes processes
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TERMINAL);
  }

  // ------ View lifecycle ------

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    // Create a horizontal split at the bottom of the workspace
    const leaf = this.app.workspace.getLeaf("split", "horizontal");
    await leaf.setViewState({
      type: VIEW_TYPE_TERMINAL,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  private async toggleView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    if (existing.length > 0) {
      // If visible, close it
      existing[0].detach();
    } else {
      await this.activateView();
    }
  }

  private newTerminalTab(): void {
    const view = this.getTerminalView();
    view?.createNewTerminal();
  }

  private cycleTerminal(direction: 1 | -1): void {
    const view = this.getTerminalView();
    view?.getManager().cycleTab(direction);
  }

  private openTerminalHere(): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      this.activateView();
      return;
    }

    const folderPath = this.resolveFileFolderPath(file);
    const view = this.getTerminalView();
    if (view) {
      view.createNewTerminal(undefined, folderPath);
    } else {
      // Open view first, then create terminal with cwd
      this.activateView().then(() => {
        setTimeout(() => {
          const v = this.getTerminalView();
          if (v && folderPath) {
            v.getManager().cdActive(folderPath);
          }
        }, 300);
      });
    }
  }

  // ------ Settings ------

  async loadSettings(): Promise<void> {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      await this.loadData()
    );
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    // Push updated settings to the view
    const view = this.getTerminalView();
    view?.updateSettings(this.settings);
  }

  refreshTerminalTheme(): void {
    const view = this.getTerminalView();
    view?.refreshTheme();
  }

  refreshTerminalFont(): void {
    const view = this.getTerminalView();
    if (view) {
      view
        .getManager()
        .applyFont(this.settings.fontFamily, this.settings.fontSize);
    }
  }

  // ------ Helpers ------

  private getTerminalView(): TerminalView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    if (leaves.length === 0) return null;
    return leaves[0].view as TerminalView;
  }

  private getVaultBasePath(): string {
    // @ts-ignore — vault.adapter.basePath exists in desktop Obsidian
    return this.app.vault.adapter.basePath || "";
  }

  private resolveFileFolderPath(file: TFile): string | null {
    const basePath = this.getVaultBasePath();
    if (!basePath) return null;

    const parentFolder = file.parent?.path || "";
    return path.join(basePath, parentFolder);
  }
}
