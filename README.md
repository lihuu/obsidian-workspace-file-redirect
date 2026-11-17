# Workspace Redirect

把 Obsidian 的布局文件 `workspace.json` 重定向到 vault 之外的本地目录。

**布局照常记住，但网盘（iCloud / Dropbox / OneDrive）不再因为它而反复同步。**

## 解决什么问题

vault 放在 iCloud Drive（或任何同步盘）里时，`.obsidian/workspace.json` 会被频繁重写——切笔记、切面板、插件轮询都会触发一次保存。每一次重写都会让同步盘上传一次，Finder 侧边栏的同步圈就一直转；多台设备同时打开同一个 vault 时，还会互相覆盖、堆出一堆 `workspace 2.json`、`workspace 3.json` 这样的冲突副本。

而 iCloud 本身**没有**「排除某个文件」的功能。

## 怎么做的

Obsidian 主包里 `saveLayout()` 的实现是：

```js
async saveLayout() {
  ...
  try {
    await app.vault.adapter.write(app.vault.configDir + "/workspace.json", JSON.stringify(layout, null, 2));
  } catch {}
}
```

它走的是 `app.vault.adapter` 上的公开方法。插件与主程序同进程，把这些方法包一层即可：

| 方法 | 行为 |
|---|---|
| `adapter.read` | 改读 `<targetDir>/<vault 名>/layout.json` |
| `adapter.write` / `writeBinary` | 改写到同一个本地文件 |
| `adapter.exists` | 问本地那份 |
| Node `fs` 的 `writeFile` / `rename` | 兜底：任何绕过 adapter 的写入也不许落进 vault |

`saveLayout()` 外层是空的 `try{}catch{}`，所以即使拦截也不会报错。

## 为什么不用别的办法

这些都在真机上试过，全部失败（iCloud 的 FileProvider 层会绕过本地文件属性）：

- **软链**：Obsidian 写配置是「临时文件 + rename」，rename 替换目录项，链接 2 秒内被顶掉
- **`chflags uchg`（不可变）**：普通目录里能拦，iCloud 目录里无效——内容照样被换、inode 照样变
- **同名目录占位**：撑 25 秒，iCloud 把云端那份下回来把目录顶掉
- **`sandbox-exec` 精确拦路径**：规则本身有效，但 Electron 的 Chromium 沙箱没法在 seatbelt 里初始化（`GPU process isn't usable`）

重定向是目前唯一稳的做法。

## 安装

手动安装：

1. 下载 `main.js` 和 `manifest.json`
2. 放到 `<vault>/.obsidian/plugins/workspace-redirect/`
3. 重启 Obsidian → 设置 → 第三方插件 → 打开 **Workspace Redirect**

## 设置

**存放目录**，默认 `~/.config/obsidian-workspace`，实际文件是 `<存放目录>/<vault 名>/layout.json`。

⚠️ 目录必须在 vault 之外。放进 vault 里等于没改，照样会被同步。

## 注意

- **仅桌面端**（`isDesktopOnly: true`）。移动端没有 Node `fs`，插件跑不起来；手机端写的是 `workspace-mobile.json`，文件名不同，与桌面端互不干扰。
- **每台打开这个 vault 的桌面设备都要启用**。没启用的那台仍会往 vault 里写，文件会经同步盘回到其他设备。
- 想恢复原样：关掉插件即可，Obsidian 会重新读写 vault 里的 `workspace.json`。
- 关掉插件后，之前被删掉的 `workspace.json` 会由 Obsidian 自己重新创建，布局从默认开始。

## License

MIT
