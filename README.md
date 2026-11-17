# Workspace File Redirect

**English** | [中文](README.zh-CN.md)

Stop your sync client from churning on Obsidian's workspace layout file.

An Obsidian plugin (desktop only) that redirects reads and writes of `.obsidian/workspace.json` to a folder **outside the vault**, so iCloud / Dropbox / OneDrive / any folder-based sync stops re-uploading it — while Obsidian still remembers your layout.

---

## The problem

Put an Obsidian vault in iCloud Drive (or Dropbox, or OneDrive) and sooner or later you see this:

- The sync indicator in Finder / the menu bar **never stops spinning**.
- `.obsidian/workspace.json` gets rewritten roughly every 30 seconds, even while you're only reading.
- Open the same vault on two devices and they overwrite each other's layout, leaving conflict copies behind: `workspace 2.json`, `workspace 3.json`, `workspace 4.json`, … One real case had **34 of them, all created in the same second**.
- Upload traffic and version history are consumed by a file that stores nothing but "which panes were open".

Two things cause it:

1. `Workspace.saveLayout()` runs on layout events and writes the entire file each time. Switching notes, panes refreshing, plugins polling — every one of them triggers a save.
2. **iCloud has no way to exclude a single file from sync.** There is no `.nosync`, no per-file ignore. If it's in the vault, it syncs.

## What this plugin does

Obsidian's `saveLayout()` goes through a public JS method on the vault adapter:

```js
async saveLayout() {
  ...
  try {
    await app.vault.adapter.write(app.vault.configDir + "/workspace.json", JSON.stringify(layout, null, 2));
  } catch {}
}
```

A plugin runs in the same process, so this plugin wraps those methods:

| Method | Redirected behaviour |
|---|---|
| `adapter.read` | reads `<targetDir>/<vault name>/layout.json` |
| `adapter.write` / `writeBinary` | writes to the same local file |
| `adapter.exists` | checks the local file |
| Node `fs` `writeFile` / `rename` | safety net — anything bypassing the adapter still can't land in the vault |

`saveLayout()` wraps the write in an empty `try{}catch{}`, so intercepting it produces no errors and no notices.

Net effect: **your layout is still remembered**, but the vault's `workspace.json` is never touched, so your sync client has nothing to upload.

## What it does *not* do

- **It does not sync your layout between devices.** Each device keeps its own layout file locally. That is the intended trade-off: layout is per-device anyway, and syncing it is what caused the conflict copies.
- It does not touch your notes, plugins, or settings — only the layout file.
- It does not run on mobile. iOS/Android have no Node `fs`. Mobile uses a different file (`workspace-mobile.json`), so it's unaffected either way.

## Install

Manual install:

1. Download `main.js` and `manifest.json` from the [latest release](../../releases) (or clone this repo).
2. Copy them into `<vault>/.obsidian/plugins/workspace-file-redirect/`.
3. Restart Obsidian → **Settings → Community plugins** → enable **Workspace File Redirect**.

Not yet in the community plugin list.

## Settings

**Storage folder** — defaults to `~/.config/obsidian-workspace`. The actual file is `<folder>/<vault name>/layout.json`.

> The folder must be **outside** the vault. Putting it inside the vault changes nothing — it would still be synced.

## Alternatives that were tested and do not work

All of these were verified on macOS with an iCloud Drive vault. iCloud's FileProvider layer sits above local file attributes, so every local trick loses:

| Approach | Result |
|---|---|
| Symlink the file outside the vault | Replaced within 2 seconds — Obsidian writes config via temp-file + `rename`, and rename replaces the directory entry |
| `chflags uchg` (immutable) | Works in a normal directory, but ignored inside iCloud: content and inode still change while the flag stays set |
| Empty directory with the same name | Survived 25 seconds — iCloud re-downloaded the cloud copy and replaced the directory |
| `sandbox-exec` denying that exact path | The rule works, but Electron's Chromium sandbox cannot initialise inside seatbelt (`GPU process isn't usable. Goodbye.`) |

Redirecting at the adapter level is the only approach that held.

## Caveats

- **Enable it on every desktop device that opens the vault.** A device without the plugin keeps writing `workspace.json` into the vault, and the file comes back to the others through sync.
- Disable the plugin and Obsidian goes back to the default behaviour: it reads and writes `<vault>/.obsidian/workspace.json` again, starting from a default layout if that file is gone.
- The plugin patches a handful of `fs` functions in the renderer process. It only ever blocks the two layout filenames; everything else passes through untouched.

## License

MIT
