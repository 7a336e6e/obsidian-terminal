import {
  App,
  PluginSettingTab,
  Setting,
} from "obsidian";
import type ObsidianTerminalPlugin from "./main";
import { PluginSettings, CwdMode } from "./types";
import { BUILTIN_PROFILES, getAllProfiles } from "./ShellProfile";
import { getAllThemes } from "./ThemeManager";
import { EditProfileModal } from "./modals";

export class TerminalSettingTab extends PluginSettingTab {
  plugin: ObsidianTerminalPlugin;

  constructor(app: App, plugin: ObsidianTerminalPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ---- Shell ----
    containerEl.createEl("h2", { text: "Shell" });

    new Setting(containerEl)
      .setName("Default profile")
      .setDesc("Shell profile used for new terminals")
      .addDropdown((dd) => {
        const profiles = getAllProfiles(this.plugin.settings.customProfiles);
        for (const p of profiles) {
          dd.addOption(p.id, p.name);
        }
        dd.setValue(this.plugin.settings.defaultProfileId);
        dd.onChange(async (val) => {
          this.plugin.settings.defaultProfileId = val;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Login shell")
      .setDesc("Start shell as a login shell (-l flag). Loads your .zprofile / .bash_profile.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.shellLoginMode)
          .onChange(async (val) => {
            this.plugin.settings.shellLoginMode = val;
            await this.plugin.saveSettings();
          })
      );

    // ---- Working directory ----
    containerEl.createEl("h2", { text: "Working Directory" });

    new Setting(containerEl)
      .setName("Default directory")
      .setDesc("Where new terminals open")
      .addDropdown((dd) => {
        dd.addOption("vault", "Vault root");
        dd.addOption("active-note", "Active note's folder");
        dd.addOption("custom", "Custom path");
        dd.setValue(this.plugin.settings.cwdMode);
        dd.onChange(async (val: string) => {
          this.plugin.settings.cwdMode = val as CwdMode;
          await this.plugin.saveSettings();
          this.display();
        });
      });

    if (this.plugin.settings.cwdMode === "custom") {
      new Setting(containerEl)
        .setName("Custom path")
        .setDesc("Absolute path for new terminals")
        .addText((text) =>
          text
            .setPlaceholder("/Users/you/projects")
            .setValue(this.plugin.settings.customCwd)
            .onChange(async (val) => {
              this.plugin.settings.customCwd = val;
              await this.plugin.saveSettings();
            })
        );
    }

    // ---- Appearance ----
    containerEl.createEl("h2", { text: "Appearance" });

    new Setting(containerEl)
      .setName("Theme")
      .setDesc("Terminal color theme. 'Obsidian Sync' matches your vault theme.")
      .addDropdown((dd) => {
        const themes = getAllThemes(this.plugin.settings.customThemes);
        for (const t of themes) {
          dd.addOption(t.id, t.name);
        }
        dd.setValue(this.plugin.settings.activeThemeId);
        dd.onChange(async (val) => {
          this.plugin.settings.activeThemeId = val;
          await this.plugin.saveSettings();
          this.plugin.refreshTerminalTheme();
        });
      });

    new Setting(containerEl)
      .setName("Font family")
      .addText((text) =>
        text
          .setValue(this.plugin.settings.fontFamily)
          .onChange(async (val) => {
            this.plugin.settings.fontFamily = val;
            await this.plugin.saveSettings();
            this.plugin.refreshTerminalFont();
          })
      );

    new Setting(containerEl)
      .setName("Font size")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.fontSize))
          .onChange(async (val) => {
            const n = parseInt(val, 10);
            if (!isNaN(n) && n >= 8 && n <= 32) {
              this.plugin.settings.fontSize = n;
              await this.plugin.saveSettings();
              this.plugin.refreshTerminalFont();
            }
          })
      );

    new Setting(containerEl)
      .setName("Cursor style")
      .addDropdown((dd) => {
        dd.addOption("block", "Block");
        dd.addOption("underline", "Underline");
        dd.addOption("bar", "Bar");
        dd.setValue(this.plugin.settings.cursorStyle);
        dd.onChange(async (val: string) => {
          this.plugin.settings.cursorStyle = val as PluginSettings["cursorStyle"];
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Cursor blink")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.cursorBlink)
          .onChange(async (val) => {
            this.plugin.settings.cursorBlink = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Scrollback lines")
      .setDesc("Number of lines to keep in terminal scrollback buffer")
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.scrollback))
          .onChange(async (val) => {
            const n = parseInt(val, 10);
            if (!isNaN(n) && n >= 100 && n <= 100000) {
              this.plugin.settings.scrollback = n;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Compact header")
      .setDesc(
        "One VS Code-style header row. Hides Obsidian's tab and navigation bar above the terminal while it has a pane of its own. Turn off to get them back, for example to drag the panel elsewhere."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.compactHeader)
          .onChange(async (val) => {
            this.plugin.settings.compactHeader = val;
            await this.plugin.saveSettings();
          })
      );

    // ---- Behaviour ----
    containerEl.createEl("h2", { text: "Behaviour" });

    new Setting(containerEl)
      .setName("Restore tabs on startup")
      .setDesc("Re-open the same tabs (with their CWDs) when Obsidian starts.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.restoreTabs)
          .onChange(async (val) => {
            this.plugin.settings.restoreTabs = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Confirm before closing")
      .setDesc("Show a confirmation dialog before closing a terminal that has a running process.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.confirmOnClose)
          .onChange(async (val) => {
            this.plugin.settings.confirmOnClose = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Copy on select")
      .setDesc("Automatically copy selected text to the clipboard (like most terminal apps).")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.copyOnSelect)
          .onChange(async (val) => {
            this.plugin.settings.copyOnSelect = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Paste sanitization warning")
      .setDesc("Show a notice before pasting text that contains newlines.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.pasteSanitize)
          .onChange(async (val) => {
            this.plugin.settings.pasteSanitize = val;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reuse tab on shell exit")
      .setDesc("When the shell exits, press Enter to restart it in the same tab instead of closing.")
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.reuseTabOnExit)
          .onChange(async (val) => {
            this.plugin.settings.reuseTabOnExit = val;
            await this.plugin.saveSettings();
          })
      );

    // ---- Editor integration ----
    containerEl.createEl("h2", { text: "Editor integration" });

    new Setting(containerEl)
      .setName("Claude Code IDE integration")
      .setDesc(
        "Run claude in a terminal and it automatically knows your active note and selection. Opens a localhost-only server. Open a new terminal tab after enabling."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.ideIntegration)
          .onChange(async (val) => {
            this.plugin.settings.ideIntegration = val;
            await this.plugin.saveSettings();
            await this.plugin.applyIntegrationSettings();
            this.display();
          })
      );

    if (this.plugin.settings.ideIntegration) {
      const status = this.plugin.getIdeStatus();
      new Setting(containerEl)
        .setName("Server status")
        .setDesc(
          status.running ? `Running on 127.0.0.1:${status.port}` : "Stopped"
        );
    }

    new Setting(containerEl)
      .setName("Context bridge (any CLI)")
      .setDesc(
        "Expose the active note and selection to any command via $OBSIDIAN_ACTIVE_FILE, $OBSIDIAN_SELECTION, and a live ~/.obsidian-term/context.json file."
      )
      .addToggle((t) =>
        t
          .setValue(this.plugin.settings.contextBridge)
          .onChange(async (val) => {
            this.plugin.settings.contextBridge = val;
            await this.plugin.saveSettings();
            await this.plugin.applyIntegrationSettings();
            this.display();
          })
      );

    // ---- Custom profiles ----
    containerEl.createEl("h2", { text: "Custom Shell Profiles" });
    containerEl.createEl("p", {
      text: "Define custom shell profiles beyond the built-in ones.",
      cls: "setting-item-description",
    });

    for (let i = 0; i < this.plugin.settings.customProfiles.length; i++) {
      const profile = this.plugin.settings.customProfiles[i];
      new Setting(containerEl)
        .setName(profile.name)
        .setDesc(profile.shellPath)
        .addButton((btn) =>
          btn.setButtonText("Edit").onClick(() => {
            new EditProfileModal(this.app, profile, async (updated) => {
              this.plugin.settings.customProfiles[i] = updated;
              await this.plugin.saveSettings();
              this.display();
            }).open();
          })
        )
        .addButton((btn) =>
          btn
            .setButtonText("Remove")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.customProfiles.splice(i, 1);
              await this.plugin.saveSettings();
              this.display();
            })
        );
    }

    new Setting(containerEl).addButton((btn) =>
      btn.setButtonText("Add profile").onClick(async () => {
        const newProfile = {
          id: `custom-${Date.now()}`,
          name: "New Shell",
          shellPath: "/bin/sh",
          args: [],
          env: {},
          icon: "terminal",
        };
        new EditProfileModal(this.app, newProfile, async (created) => {
          this.plugin.settings.customProfiles.push(created);
          await this.plugin.saveSettings();
          this.display();
        }).open();
      })
    );
  }
}
