# Workspace File Redirect

[English](README.md) | **中文**

把 Obsidian 的布局文件从 vault 里「请出去」——让网盘不再因为它反复同步。

这是一个 Obsidian 插件（仅桌面端），把 `.obsidian/workspace.json` 的读写重定向到 **vault 之外** 的本地目录。布局照常记住，但 iCloud / Dropbox / OneDrive 这些同步盘不会再被它触发上传。

---

## 要解决的问题

把 Obsidian vault 放进 iCloud Drive（或 Dropbox、OneDrive）之后，迟早会遇到这些：

- Finder 或菜单栏的同步图标 **一直转个不停**
- `.obsidian/workspace.json` 大约每 30 秒就被重写一次，即使你只是在看
- 两台设备同时打开同一个 vault，布局互相覆盖，留下一堆冲突副本：`workspace 2.json`、`workspace 3.json`、`workspace 4.json`…… 实际遇到过一次 **34 个，全是同一秒生成的**
- 上传流量和版本历史被一个只记录「打开了哪些面板」的文件吃掉

原因有两条：

1. `Workspace.saveLayout()` 挂在布局事件上，每次触发都整份重写。切笔记、面板刷新、插件轮询——任何一件事都会触发一次保存。
2. **iCloud 没有「排除某个文件」的能力。** 没有 `.nosync`，没有单文件忽略。只要文件在 vault 里，它就会被同步。

## 插件做了什么

Obsidian 的 `saveLayout()` 走的是 vault adapter 上的一个公开 JS 方法：

```js
async saveLayout() {
  ...
  try {
    await app.vault.adapter.write(app.vault.configDir + "/workspace.json", JSON.stringify(layout, null, 2));
  } catch {}
}
```

插件与主程序同一个进程，于是把这些方法包了一层：

| 方法 | 重定向后的行为 |
|---|---|
| `adapter.read` | 改读 `<存放目录>/<vault 名>/layout.json` |
| `adapter.write` / `writeBinary` | 改写到同一个本地文件 |
| `adapter.exists` | 检查本地那份 |
| Node `fs` 的 `writeFile` / `rename` | 兜底——绕过 adapter 的写入也进不了 vault |

`saveLayout()` 外面套的是空的 `try{}catch{}`，所以拦截它不会产生任何报错或提示。

结果：**布局照样被记住**，但 vault 里的 `workspace.json` 一个字节都不动，同步盘也就没东西可传。

## 它不做什么

- **它不会在设备之间同步布局。** 每台设备各自保存自己的布局。这是刻意的取舍：布局本来就是按设备区分的，而同步它正是冲突副本的来源。
- 不碰笔记、插件、设置——只管布局文件。
- 移动端跑不了（iOS/Android 没有 Node `fs`）。手机端用的是另一个文件 `workspace-mobile.json`，两边互不影响。

## 安装

手动安装：

1. 从 [最新 release](../../releases) 下载 `main.js` 和 `manifest.json`（或直接克隆本仓库）
2. 放进 `<vault>/.obsidian/plugins/workspace-file-redirect/`
3. 重启 Obsidian → **设置 → 第三方插件** → 启用 **Workspace File Redirect**

尚未进入 Obsidian 社区插件列表。

## 设置

**存放目录** —— 默认 `~/.config/obsidian-workspace`，实际文件是 `<存放目录>/<vault 名>/layout.json`。

> 目录必须在 vault **之外**。放进 vault 里等于没改，照样会被同步。

## 试过但不行的方案

以下都在 macOS + iCloud Drive vault 上实测过。iCloud 的 FileProvider 层凌驾于本地文件属性之上，所以本地层面的手段全部失效：

| 方案 | 结果 |
|---|---|
| 把文件软链到 vault 外 | 2 秒内被顶掉——Obsidian 写配置是「临时文件 + rename」，rename 替换目录项 |
| `chflags uchg`（不可变） | 普通目录里能拦住，iCloud 目录里无效：内容照样变、inode 照样换，flag 还挂着 |
| 用同名空目录占位 | 撑了 25 秒，iCloud 把云端那份下回来，目录被顶掉 |
| `sandbox-exec` 精确拒绝该路径 | 规则本身有效，但 Electron 的 Chromium 沙箱无法在 seatbelt 内初始化（`GPU process isn't usable. Goodbye.`） |

在 adapter 这一层重定向，是唯一站得住的做法。

## 注意事项

- **每一台打开这个 vault 的桌面设备都要启用。** 没启用的那台仍会往 vault 里写 `workspace.json`，文件会经同步盘回到其他设备。
- 关掉插件即恢复默认行为：Obsidian 重新读写 `<vault>/.obsidian/workspace.json`；如果那个文件已不存在，会从默认布局开始。
- 插件会包装渲染进程里的几个 `fs` 函数，但只拦这两个布局文件名，其余调用原样透传。

## License

MIT
