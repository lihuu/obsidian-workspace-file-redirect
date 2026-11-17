# Workspace File Redirect

**English** | [中文](README.zh-CN.md)

Stop your sync client from churning on Obsidian's workspace layout file.

An Obsidian plugin (desktop only) that redirects reads and writes of `.obsidian/workspace.json` to a folder **outside the vault**, so iCloud / Dropbox / OneDrive / any folder-based sync stops re-uploading it — while Obsidian still remembers your layout.

---

## The problem

Put an Obsidian vault in iCloud Drive (or Dropbox, or OneDrive) and you end up fighting two separate problems.

### 1. The sync indicator never stops

- `.obsidian/workspace.json` gets rewritten roughly every 30 seconds, even while you're only reading.
- The sync indicator in Finder / the menu bar **keeps spinning**, and upload traffic plus version history get consumed by a file that stores nothing but "which panes were open".

Cause: `Workspace.saveLayout()` runs on layout events and rewrites the entire file each time. Switching notes, panes refreshing, plugins polling — every one of them triggers a save.

### 2. Multi-device sync turns into a pile of conflict copies

Open the same vault on two machines and let both sync through the cloud, and the layout file becomes a collision point. Each device writes the **whole file**, the sync client sees concurrent modifications, and resolves them the only way it can — by keeping both:

```
.obsidian/workspace.json
.obsidian/workspace 2.json
.obsidian/workspace 3.json
...
.obsidian/workspace 34.json
```

They are never cleaned up by anything. In one real vault, **34 of them were created within the same second**, and from then on every full re-index has to enumerate and re-sync all 34 stale layout snapshots — forever. Conflict copies also appear under other names (`workspace.json 2.json`, `workspace(1).json`) depending on which sync client produced them.

The deeper reason both problems exist: **iCloud has no way to exclude a single file from sync.** There is no `.nosync`, no per-file ignore. If it's in the vault, it syncs — and if two devices both write it, it forks.

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
| `adapter.read` | reads `<targetDir>/<vault name>/workspace.json` |
| `adapter.write` / `writeBinary` | writes to the same local file |
| `adapter.exists` | checks the local file |
| Node `fs` `writeFile` / `rename` | safety net — anything bypassing the adapter still can't land in the vault |

Matching is by **exact resolved path**, not by filename. The plugin only touches these two files:

```
<vault>/.obsidian/workspace.json
<vault>/.obsidian/workspace-mobile.json
```

A note that happens to be called `workspace.json`, or any `workspace.json` inside some other folder or vault, is left completely alone — no interception, no silent failed writes.

`saveLayout()` wraps the write in an empty `try{}catch{}`, so intercepting it produces no errors and no notices.

### But reading is not enough — Obsidian reads *before* plugins load

Redirecting reads alone does not restore your layout. Obsidian's startup does, roughly:

```js
startUp.loadingWorkspace();
await workspace.loadLayout();   // ← happens before any community plugin is loaded
```

At that moment this plugin does not exist yet, so `loadLayout()` reads the *vault's* `workspace.json`, finds nothing, and falls back to the default empty layout — then saves that default right away, overwriting the good copy.

So version 1.1.0 does two more things:

1. **Waits for `onLayoutReady`, then puts the stored layout back** — via `workspace.changeLayout(stored)`, only when the file sets differ (no pointless reload on every launch).
2. **Drops saves during that window**, so the empty default layout never lands on top of your stored one. Writes resume as soon as the layout is back.
3. Keeps a `workspace.json.bak` snapshot on every startup, so a bad write is always recoverable.

Net effect:

- **Your layout is still remembered** — same behaviour as before, just stored somewhere else.
- The vault's `workspace.json` is never written, so **your sync client has nothing to upload**.
- Because no device writes it into the vault any more, **the multi-device collision disappears entirely**: no concurrent writes, no conflict copies, and any `workspace N.json` left over from before can be deleted for good.

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

**Storage folder** — defaults to `~/.config/obsidian-workspace`. The actual file is `<folder>/<vault name>/workspace.json`.

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
