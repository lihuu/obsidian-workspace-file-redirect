const { Plugin, PluginSettingTab, Setting } = require("obsidian");
const fs = require("fs");
const path = require("path");
const os = require("os");

const DEFAULT_SETTINGS = {
  // 存放布局文件的本机目录（必须在 vault 之外，否则照样会被同步）
  targetDir: path.join(os.homedir(), ".config", "obsidian-workspace"),
};

module.exports = class WorkspaceFileRedirect extends Plugin {
  async onload() {
    this.undo = [];
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.resolveLocalPath();
    this.resolveTargets();

    // 打补丁前先抓住原始写入函数，重定向写入用它，避免被下面的兜底误拦
    this._writeFileSync = fs.writeFileSync.bind(fs);

    const adapter = this.app.vault.adapter;

    // ① 读：loadLayout() 走 adapter.read(configDir + "/workspace.json")
    this.redirectRead(adapter, "read");

    // ② 写：saveLayout() 走 adapter.write(...)
    this.redirectWrite(adapter, "write");
    this.redirectWrite(adapter, "writeBinary");

    // ③ 存在性检查
    this.redirectExists(adapter, "exists");

    // ④ 兜底：绕过 adapter 的写入也不许落进 vault
    this.blockFs(fs);
    try { this.blockFs(require("original-fs")); } catch (e) {}

    this.addSettingTab(new WorkspaceFileRedirectTab(this.app, this));
    console.log(`[workspace-file-redirect] ${this.localPath}`);
  }

  resolveLocalPath() {
    const vault = this.app.vault.getName().replace(/[/:]/g, "-");
    this.localPath = path.join(this.settings.targetDir, vault, "workspace.json");
  }

  // 只针对 vault 配置目录下那两个确切文件，其他同名文件一律不管
  resolveTargets() {
    const adapter = this.app.vault.adapter;
    const base = adapter.basePath || (adapter.getBasePath && adapter.getBasePath()) || "";
    const cfg = this.app.vault.configDir; // 通常是 ".obsidian"
    this.relTargets = new Set([`${cfg}/workspace.json`, `${cfg}/workspace-mobile.json`]);
    this.absTargets = new Set([...this.relTargets].map((r) => path.resolve(base, r)));
  }

  // adapter 收到的是 vault 相对路径
  isRelTarget(p) {
    const n = p.replace(/\\/g, "/").replace(/^\.\//, "");
    return this.relTargets.has(n);
  }

  // fs 收到的是绝对路径
  isAbsTarget(p) {
    const abs = path.resolve(p);
    if (this.absTargets.has(abs)) return true;
    try {
      const realDir = fs.realpathSync(path.dirname(abs));
      return this.absTargets.has(path.join(realDir, path.basename(abs)));
    } catch (e) {
      return false;
    }
  }

  redirectRead(adapter, name) {
    const orig = adapter[name];
    if (typeof orig !== "function") return;
    const self = this;
    adapter[name] = function (p, ...rest) {
      if (self.isRelTarget(p)) {
        try { return Promise.resolve(fs.readFileSync(self.localPath, "utf8")); }
        catch (e) { return Promise.resolve("{}"); }
      }
      return orig.call(this, p, ...rest);
    };
    this.undo.push(() => { adapter[name] = orig; });
  }

  redirectWrite(adapter, name) {
    const orig = adapter[name];
    if (typeof orig !== "function") return;
    const self = this;
    adapter[name] = function (p, data, ...rest) {
      if (self.isRelTarget(p)) {
        try {
          fs.mkdirSync(path.dirname(self.localPath), { recursive: true });
          self._writeFileSync(self.localPath, data);
        } catch (e) { console.error("[workspace-file-redirect] 写入失败", e); }
        return Promise.resolve();
      }
      return orig.call(this, p, data, ...rest);
    };
    this.undo.push(() => { adapter[name] = orig; });
  }

  redirectExists(adapter, name) {
    const orig = adapter[name];
    if (typeof orig !== "function") return;
    const self = this;
    adapter[name] = function (p, ...rest) {
      if (self.isRelTarget(p)) {
        try { return Promise.resolve(fs.existsSync(self.localPath)); }
        catch (e) { return Promise.resolve(false); }
      }
      return orig.call(this, p, ...rest);
    };
    this.undo.push(() => { adapter[name] = orig; });
  }

  blockFs(mod) {
    if (!mod) return;
    const self = this;
    for (const m of ["writeFile", "writeFileSync"]) {
      const orig = mod[m];
      if (typeof orig !== "function") continue;
      mod[m] = function (p, ...rest) {
        if (self.isAbsTarget(p)) return Promise.resolve();
        return orig.call(this, p, ...rest);
      };
      this.undo.push(() => { mod[m] = orig; });
    }
    for (const m of ["rename", "renameSync"]) {
      const orig = mod[m];
      if (typeof orig !== "function") continue;
      mod[m] = function (from, to, ...rest) {
        if (self.isAbsTarget(to)) return Promise.resolve();
        return orig.call(this, from, to, ...rest);
      };
      this.undo.push(() => { mod[m] = orig; });
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.resolveLocalPath();
  }

  onunload() {
    for (const f of this.undo) f();
    this.undo = [];
    console.log("[workspace-file-redirect] 已恢复原行为");
  }
};

class WorkspaceFileRedirectTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h3", { text: "Workspace 文件重定向" });
    containerEl.createEl("p", {
      text: "Obsidian 的布局文件（vault 里的 .obsidian/workspace.json）不再读写 vault 里的那份，而是改用下面目录里的同名文件。目录必须在 vault 之外，否则照样会被同步。",
    });
    new Setting(containerEl)
      .setName("存放目录")
      .setDesc(`默认 ${DEFAULT_SETTINGS.targetDir}，实际文件为 <目录>/<vault 名>/workspace.json`)
      .addText((t) =>
        t.setValue(this.plugin.settings.targetDir).onChange(async (v) => {
          this.plugin.settings.targetDir = v.trim() || DEFAULT_SETTINGS.targetDir;
          await this.plugin.saveSettings();
        })
      );
    containerEl.createEl("p", { text: `当前实际路径：${this.plugin.localPath}` });
    containerEl.createEl("p", {
      text: `被接管的确切文件：${[...this.plugin.relTargets].join("、")}（只针对本 vault 配置目录，其他同名文件不受影响）`,
    });
  }
}
