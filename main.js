const { Plugin, PluginSettingTab, Setting } = require("obsidian");
const fs = require("fs");
const path = require("path");
const os = require("os");

// 布局文件：workspace.json / workspace-mobile.json
const BLOCKED = /(^|\/)workspace(-mobile)?\.json$/;
const isTarget = (p) => typeof p === "string" && BLOCKED.test(p.replace(/\\/g, "/"));

const DEFAULT_SETTINGS = {
  // 存放布局文件的本机目录（必须在 vault 之外，否则照样会被同步）
  targetDir: path.join(os.homedir(), ".config", "obsidian-workspace"),
};

module.exports = class WorkspaceRedirect extends Plugin {
  async onload() {
    this.undo = [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.resolveLocalPath();

    const adapter = this.app.vault.adapter;

    // ① 读：loadLayout() 走 adapter.read(configDir + "/workspace.json")
    this.redirectRead(adapter, "read");

    // ② 写：saveLayout() 走 adapter.write(...)
    this.redirectWrite(adapter, "write");
    this.redirectWrite(adapter, "writeBinary");

    // ③ 存在性检查
    this.redirectExists(adapter, "exists");

    // ④ 兜底：任何绕过 adapter 的写入也不许落进 vault
    this.blockFs(fs);
    try { this.blockFs(require("original-fs")); } catch (e) {}

    this.addSettingTab(new WorkspaceRedirectTab(this.app, this));
    console.log(`[workspace-redirect] 布局文件重定向到 ${this.localPath}`);
  }

  resolveLocalPath() {
    const vault = this.app.vault.getName().replace(/[/:]/g, "-");
    this.localPath = path.join(this.settings.targetDir, vault, "layout.json");
  }

  redirectRead(adapter, name) {
    const orig = adapter[name];
    if (typeof orig !== "function") return;
    adapter[name] = function (p, ...rest) {
      if (isTarget(p)) {
        try { return Promise.resolve(fs.readFileSync(this.__wrLocalPath, "utf8")); }
        catch (e) { return Promise.resolve("{}"); }
      }
      return orig.call(this, p, ...rest);
    };
    adapter.__wrLocalPath = this.localPath;
    this.undo.push(() => { adapter[name] = orig; });
  }

  redirectWrite(adapter, name) {
    const orig = adapter[name];
    if (typeof orig !== "function") return;
    adapter[name] = function (p, data, ...rest) {
      if (isTarget(p)) {
        const target = this.__wrLocalPath;
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, data);
        } catch (e) { console.error("[workspace-redirect] 写入失败", e); }
        return Promise.resolve();
      }
      return orig.call(this, p, data, ...rest);
    };
    adapter.__wrLocalPath = this.localPath;
    this.undo.push(() => { adapter[name] = orig; });
  }

  redirectExists(adapter, name) {
    const orig = adapter[name];
    if (typeof orig !== "function") return;
    adapter[name] = function (p, ...rest) {
      if (isTarget(p)) {
        try { return Promise.resolve(fs.existsSync(this.__wrLocalPath)); }
        catch (e) { return Promise.resolve(false); }
      }
      return orig.call(this, p, ...rest);
    };
    adapter.__wrLocalPath = this.localPath;
    this.undo.push(() => { adapter[name] = orig; });
  }

  blockFs(mod) {
    if (!mod) return;
    for (const m of ["writeFile", "writeFileSync"]) {
      const orig = mod[m];
      if (typeof orig !== "function") continue;
      mod[m] = function (p, ...rest) {
        if (isTarget(p)) return Promise.resolve();
        return orig.call(this, p, ...rest);
      };
      this.undo.push(() => { mod[m] = orig; });
    }
    for (const m of ["rename", "renameSync"]) {
      const orig = mod[m];
      if (typeof orig !== "function") continue;
      mod[m] = function (from, to, ...rest) {
        if (isTarget(to)) return Promise.resolve();
        return orig.call(this, from, to, ...rest);
      };
      this.undo.push(() => { mod[m] = orig; });
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.resolveLocalPath();
    this.app.vault.adapter.__wrLocalPath = this.localPath;
  }

  onunload() {
    for (const f of this.undo) f();
    this.undo = [];
    console.log("[workspace-redirect] 已恢复原行为");
  }
};

class WorkspaceRedirectTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Workspace 重定向" });
    containerEl.createEl("p", {
      text: "Obsidian 的布局文件（workspace.json）不再读写 vault 里的那份，而是改用下面目录里的 layout.json。目录必须在 vault 之外，否则照样会被同步。",
    });
    new Setting(containerEl)
      .setName("存放目录")
      .setDesc(`默认 ${DEFAULT_SETTINGS.targetDir}，实际文件为 <目录>/<vault 名>/layout.json`)
      .addText((t) =>
        t.setValue(this.plugin.settings.targetDir).onChange(async (v) => {
          this.plugin.settings.targetDir = v.trim() || DEFAULT_SETTINGS.targetDir;
          await this.plugin.saveSettings();
        })
      );
    containerEl.createEl("p", { text: `当前实际路径：${this.plugin.localPath}` });
  }
}
