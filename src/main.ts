import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  Notice,
} from "obsidian";
import {
  FileSystemAdapter,
} from "obsidian";
import {
  VIEW_TYPE_TERMINAL,
  PluginSettings,
  DEFAULT_SETTINGS,
} from "./types";
import { TerminalView } from "./TerminalView";
import { TerminalSettingTab } from "./settings";
import { ContextProvider } from "./ide/ContextProvider";
import { IdeServer } from "./ide/IdeServer";
import { ContextBridge } from "./ide/ContextBridge";
import * as path from "path";
import { spawnSync } from "child_process";

export default class ObsidianTerminalPlugin extends Plugin {
  settings: PluginSettings;
  private statusBarEl: HTMLElement | null = null;
  private contextProvider!: ContextProvider;
  private ideServer!: IdeServer;
  private contextBridge!: ContextBridge;

  async onload(): Promise<void> {
    await this.loadSettings();

    const vaultBasePath = this.getVaultBasePath();
    this.contextProvider = new ContextProvider(this.app, this, vaultBasePath);
    this.contextProvider.register();
    this.ideServer = new IdeServer(
      this.contextProvider,
      vaultBasePath,
      this.manifest.version
    );
    this.contextBridge = new ContextBridge(this.contextProvider, vaultBasePath);
    await this.applyIntegrationSettings();

    this.registerView(VIEW_TYPE_TERMINAL, (leaf) => {
      return new TerminalView(
        leaf,
        this.settings,
        this.getVaultBasePath(),
        () => this.getInjectedTerminalEnv()
      );
    });

    this.addRibbonIcon("terminal", "Open terminal", () => {
      this.activateView();
    });

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
      id: "close-terminal-tab",
      name: "Close current terminal tab",
      callback: () => {
        const view = this.getTerminalView();
        view?.closeActiveTab();
      },
    });

    this.addCommand({
      id: "terminal-here",
      name: "Open terminal in current note's folder",
      callback: () => this.openTerminalHere(),
    });

    this.addCommand({
      id: "clear-terminal",
      name: "Clear terminal",
      callback: () => {
        const view = this.getTerminalView();
        view?.getManager().getActiveInstance()?.clear();
      },
    });

    this.addCommand({
      id: "send-selection-to-terminal",
      name: "Send selection to terminal",
      callback: async () => {
        const text = window.getSelection()?.toString();
        if (!text) {
          new Notice("No text selected.");
          return;
        }
        await this.activateView();
        const view = this.getTerminalView();
        view?.getManager().getActiveInstance()?.write(text);
      },
    });

    this.addCommand({
      id: "find-in-terminal",
      name: "Find in terminal",
      callback: () => {
        const view = this.getTerminalView();
        if (view) {
          view.showSearch();
        } else {
          this.activateView().then(() => this.getTerminalView()?.showSearch());
        }
      },
    });

    this.addSettingTab(new TerminalSettingTab(this.app, this));

    this.statusBarEl = this.addStatusBarItem();
    this.updateStatusBar(0);
    this.statusBarEl.addClass("obsidian-terminal-statusbar");
    this.statusBarEl.addEventListener("click", () => this.toggleView());

    this.registerEvent(
      // css-change is undocumented but stable — fires when the Obsidian theme changes
      this.app.workspace.on("css-change" as any, () => {
        this.refreshTerminalTheme();
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file: TFile | null) => {
        if (file && this.settings.cwdMode === "active-note") {
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
    // Persist session before unloading
    const view = this.getTerminalView();
    if (view && this.settings.restoreTabs) {
      view.serializeSession();
      await this.saveSettings();
    }
    await this.ideServer?.stop();
    this.contextBridge?.stop();
    this.contextProvider?.dispose();
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TERMINAL);
  }

  // ------ View lifecycle ------

  async activateView(): Promise<void> {
    if (!this.checkPython3()) return;

    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf("split", "horizontal");
    await leaf.setViewState({
      type: VIEW_TYPE_TERMINAL,
      active: true,
    });
    this.app.workspace.revealLeaf(leaf);

    // Wire up status bar count once the view is open
    const view = this.getTerminalView();
    if (view) {
      view.onTabCountChanged = (n) => this.updateStatusBar(n);
    }
  }

  private async toggleView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    if (existing.length > 0) {
      // Persist session before closing
      const view = this.getTerminalView();
      if (view && this.settings.restoreTabs) {
        view.serializeSession();
        await this.saveSettings();
      }
      existing[0].detach();
      this.updateStatusBar(0);
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
      view.createNewTerminal(undefined, folderPath ?? undefined);
    } else {
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

  private updateStatusBar(count: number): void {
    if (!this.statusBarEl) return;
    this.statusBarEl.setText(count > 0 ? `Terminal · ${count}` : "Terminal");
  }

  private checkPython3(): boolean {
    const result = spawnSync("python3", ["--version"], { timeout: 3000 });
    if (result.error || result.status !== 0) {
      new Notice(
        "ObsidianTerm: python3 not found. Install Python 3 and make sure it's on your PATH.",
        8000
      );
      return false;
    }
    return true;
  }

  private getTerminalView(): TerminalView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    if (leaves.length === 0) return null;
    return leaves[0].view as TerminalView;
  }

  private getVaultBasePath(): string {
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      return adapter.getBasePath();
    }
    return (adapter as any).basePath || "";
  }

  // ------ Editor integration ------

  /** Start/stop the IDE server and context bridge to match the current settings. */
  async applyIntegrationSettings(): Promise<void> {
    try {
      if (this.settings.ideIntegration && !this.ideServer.running) {
        await this.ideServer.start();
      } else if (!this.settings.ideIntegration && this.ideServer.running) {
        await this.ideServer.stop();
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      new Notice(`ObsidianTerm: could not start IDE integration. ${detail}`, 8000);
    }

    if (this.settings.contextBridge) {
      this.contextBridge.start();
    } else {
      this.contextBridge.stop();
    }
  }

  /** Current IDE server status, for the settings panel. */
  getIdeStatus(): { running: boolean; port: number } {
    return {
      running: this.ideServer?.running ?? false,
      port: this.ideServer?.port ?? 0,
    };
  }

  /** Env vars merged into each new shell at spawn time. */
  private getInjectedTerminalEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    if (this.settings.ideIntegration && this.ideServer?.running) {
      env.CLAUDE_CODE_SSE_PORT = String(this.ideServer.port);
      env.ENABLE_IDE_INTEGRATION = "true";
    }
    if (this.settings.contextBridge && this.contextBridge) {
      Object.assign(env, this.contextBridge.getSpawnEnv());
    }
    return env;
  }

  private resolveFileFolderPath(file: TFile): string | null {
    const basePath = this.getVaultBasePath();
    if (!basePath) return null;
    const parentFolder = file.parent?.path || "";
    return path.join(basePath, parentFolder);
  }
}
