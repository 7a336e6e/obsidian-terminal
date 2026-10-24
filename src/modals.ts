import { App, Modal, Setting, TextComponent } from "obsidian";
import { TerminalProfile } from "./types";

export class RenameModal extends Modal {
  private inputEl: TextComponent;
  private onSubmit: (name: string) => void;

  constructor(app: App, currentTitle: string, onSubmit: (name: string) => void) {
    super(app);
    this.onSubmit = onSubmit;
    this.titleEl.setText("Rename terminal");

    this.inputEl = new TextComponent(this.contentEl);
    this.inputEl.setValue(currentTitle);
    this.inputEl.inputEl.style.width = "100%";
    this.inputEl.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") this.submit();
      if (e.key === "Escape") this.close();
    });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn.setButtonText("Rename").setCta().onClick(() => this.submit())
      )
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => this.close())
      );
  }

  onOpen(): void {
    this.inputEl.inputEl.focus();
    this.inputEl.inputEl.select();
  }

  private submit(): void {
    const val = this.inputEl.getValue().trim();
    if (val) {
      this.onSubmit(val);
      this.close();
    }
  }
}

export class ConfirmCloseModal extends Modal {
  private onConfirm: () => void;

  constructor(app: App, tabTitle: string, onConfirm: () => void) {
    super(app);
    this.onConfirm = onConfirm;
    this.titleEl.setText("Close terminal?");
    this.contentEl.createEl("p", {
      text: `"${tabTitle}" has a running process. Close anyway?`,
    });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn.setButtonText("Close").setWarning().onClick(() => {
          this.onConfirm();
          this.close();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => this.close())
      );
  }
}

export class ConfirmModal extends Modal {
  constructor(
    app: App,
    title: string,
    message: string,
    confirmText: string,
    onConfirm: () => void
  ) {
    super(app);
    this.titleEl.setText(title);
    this.contentEl.createEl("p", { text: message });

    new Setting(this.contentEl)
      .addButton((btn) =>
        btn.setButtonText(confirmText).setWarning().onClick(() => {
          onConfirm();
          this.close();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => this.close())
      );
  }
}

export class EditProfileModal extends Modal {
  private profile: TerminalProfile;
  private onSubmit: (updated: TerminalProfile) => void;

  private nameVal: string;
  private pathVal: string;
  private argsVal: string;
  private envVal: string;
  private iconVal: string;

  constructor(
    app: App,
    profile: TerminalProfile,
    onSubmit: (updated: TerminalProfile) => void
  ) {
    super(app);
    this.profile = { ...profile };
    this.onSubmit = onSubmit;
    this.nameVal = profile.name;
    this.pathVal = profile.shellPath;
    this.argsVal = profile.args.join(", ");
    this.envVal = Object.entries(profile.env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");
    this.iconVal = profile.icon;
    this.titleEl.setText("Edit shell profile");
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    new Setting(contentEl)
      .setName("Name")
      .addText((t) =>
        t.setValue(this.nameVal).onChange((v) => (this.nameVal = v))
      );

    new Setting(contentEl)
      .setName("Shell path")
      .setDesc("Absolute path, e.g. /bin/zsh")
      .addText((t) =>
        t.setValue(this.pathVal).onChange((v) => (this.pathVal = v))
      );

    new Setting(contentEl)
      .setName("Arguments")
      .setDesc("Comma-separated, e.g. -l, --rcfile /path/to/rc")
      .addText((t) =>
        t.setValue(this.argsVal).onChange((v) => (this.argsVal = v))
      );

    new Setting(contentEl)
      .setName("Environment variables")
      .setDesc("One KEY=VALUE per line")
      .addTextArea((t) => {
        t.setValue(this.envVal).onChange((v) => (this.envVal = v));
        t.inputEl.rows = 4;
        t.inputEl.style.width = "100%";
        t.inputEl.style.fontFamily = "monospace";
      });

    new Setting(contentEl)
      .setName("Icon")
      .setDesc("Obsidian icon name, e.g. terminal")
      .addText((t) =>
        t.setValue(this.iconVal).onChange((v) => (this.iconVal = v))
      );

    const errorEl = contentEl.createEl("p", { cls: "mod-warning" });
    errorEl.style.display = "none";

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Save")
          .setCta()
          .onClick(() => {
            const err = this.validate();
            if (err) {
              errorEl.setText(err);
              errorEl.style.display = "";
              return;
            }
            this.onSubmit(this.buildProfile());
            this.close();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Cancel").onClick(() => this.close())
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private validate(): string | null {
    if (!this.nameVal.trim()) return "Name is required.";
    if (!this.pathVal.startsWith("/")) return "Shell path must be absolute (start with /).";
    for (const line of this.envVal.split("\n").filter((l) => l.trim())) {
      if (!line.includes("=")) return `Invalid env line (missing =): "${line}"`;
    }
    return null;
  }

  private buildProfile(): TerminalProfile {
    const args = this.argsVal
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const env: Record<string, string> = {};
    for (const line of this.envVal.split("\n").filter((l) => l.trim())) {
      const idx = line.indexOf("=");
      if (idx > 0) {
        env[line.slice(0, idx).trim()] = line.slice(idx + 1);
      }
    }

    return {
      id: this.profile.id,
      name: this.nameVal.trim(),
      shellPath: this.pathVal.trim(),
      args,
      env,
      icon: this.iconVal.trim() || "terminal",
    };
  }
}
