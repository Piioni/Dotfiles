# herdr-dots

My configuration of the [Herdr](https://herdr.dev) desktop app: a layout and the mods behind it. Herdr's interface is
files (layouts, mods, keys, settings), so this folder *is* the app's look and behavior.

![The piioni layout](hero.png)

*(The terminal and work project names are blurred in the screenshots.)*

## The layout: `piioni`

```
┌ sidebar ─────────┬ tab bar (ion-tabs)                    ┬ panel buttons ┐
│ search / toggle  ├───────────────────────────────────────┼───────────────┤
│ accounts (relevo)│                                       │ panel bar     │
│ spaces           │          terminal panes               │ (relevo)      │
│ agents           │                                       ├───────────────┤
│  (relevo-agents) │                                       │ Files │ Changes│
│ settings         │                                       │ PRs │ Linear   │
├──────────────────┴───────────────────────────────────────┴───────────────┤
│ status bar                                                               │
└──────────────────────────────────────────────────────────────────────────┘
```

Sidebar on the left (accounts and usage, spaces, agents), terminals in the middle, and a switchable panel on the right
for files, changes, pull requests and tickets. Theme: Catppuccin (`themes/catppuccin.json`).

## Mods

| Mod | What it is | |
|---|---|---|
| [`relevo`](mods/relevo) | Accounts and their usage, launchers, handoff between accounts, the panel bar and Settings | ![](mods/relevo/accounts.png) |
| [`relevo-agents`](mods/relevo-agents) | Herdr's Agents list + a launcher menu, an account circle and a background-work capsule | ![](mods/relevo-agents/screenshot.png) |
| [`prs`](mods/prs) | GitHub pull requests: a panel and a full PR dialog | ![](mods/prs/screenshot.png) |
| [`linear`](mods/linear) | Your Linear tickets as a panel | ![](mods/linear/screenshot.png) |
| [`ion-files`](mods/ion-files) | File tree with file operations and Helix | ![](mods/ion-files/screenshot.png) |
| [`ion-changes`](mods/ion-changes) | Uncommitted changes, Neovim diffs and a commit box | ![](mods/ion-changes/screenshot.png) |
| [`ion-tabs`](mods/ion-tabs) | The tab bar and the panel buttons | ![](mods/ion-tabs/screenshot.png) |

Each mod has its own README with what it does, why it exists, what it needs and how to test it.

### Naming

- `ion-*`: clones of Herdr's own mods (`files`, `changes`, `tabs`), improved. Herdr rewrites its shipped mods on every
  start, so changes to them have to live in a clone with another name.
- `relevo`, `relevo-agents`: depend on the Relevo setup (accounts and launchers), and derive from
  [herdr-relevo](https://github.com/johnny4young/herdr-relevo).
- `prs`, `linear`: my own.

## Install

Herdr reads `~/.config/herdr-app`, and creates it on first start, so the folder usually exists. With Herdr closed,
turn it into a checkout of this repo (the allow-list `.gitignore` keeps Herdr's own files out of the way):

```sh
cd ~/.config/herdr-app
git init -b main
git remote add origin git@github.com:Piioni/herdr-dots.git
git fetch origin
git checkout -f -B main origin/main    # overwrites keys.json, settings.json and the piioni layout
```

Then start Herdr and switch to the layout (`Ctrl+Shift+L`, or `herdr-app do layout.switch '{"name":"piioni"}'`).

### What the mods need

| Need | For |
|---|---|
| `gh` ([GitHub CLI](https://cli.github.com/)), logged in | `prs` |
| Linear API key in `~/.config/linear/token` | `linear`, the Linear chip in `prs` |
| `hx` (Helix) | `ion-files` |
| `git` and `nvim` | `ion-changes` |
| Claude Code, and optionally its hook (`mods/relevo/hooks`) | account usage, the account circle, background work |
| Edit `mods/relevo/config.js` (or use Settings) | your accounts and launchers: the checked-in one is mine |

## What is versioned

Only what is mine; the `.gitignore` is an allow-list. Herdr's own files (shipped mods and layouts, icons, type
definitions, `AGENTS.md`), per-mod data and caches (`data/`), and window and shared state are ignored.

## Development

```sh
herdr-app check mods/<mod>                 # loads a mod once; required before calling one done
cd mods/relevo && node --test 'test/*.test.mjs'
cd mods/prs    && node --test test/*.test.mjs
```

`herdr-app shot file.png` saves a real screenshot of the running app.

## License

Apache License 2.0, see [LICENSE](LICENSE) and [NOTICE](NOTICE). Parts derive from herdr-relevo and from Herdr's own mods.
