// What tells the Inbox to look again: agents, finished commands and the repos' git folders, with a slow timer behind
// them for edits nothing reports. Mixed into Inbox, so `this` is the Inbox.
import { agents, exec, panes, spaces, terminals, watchFolder, window } from "herdr";
import { ADDRESSED_LABEL } from "./lib/addressed.js";
import { LOCAL_EVERY, TREES_EVERY, endedFolders, gitStateChanged, isDue, repoOf, runningCommands } from "./lib/refresh.js";

// A commit is many writes, and they arrive in batches.
const WATCH_SETTLE = 2000;

export class LiveViews {
  startLive(cx) {
    this.dirty = new Set();
    this.wanted = new Set();
    this.looping = new Set();
    this.gitDirs = new Map();
    this.localAt = 0;
    this.treesAt = 0;
    const ps = panes();
    this.commands = runningCommands(ps);
    this.live = this.liveSigns(ps);
    cx.timer.every(1500, (cx) => this.watchLive(cx));
  }

  // In-memory only: no git and no redraw unless a scan finds something new.
  liveSigns(ps) {
    const cwd = new Map(ps.map((p) => [p.pane, p.cwd]));
    const terms = new Map(terminals().map((k) => [k.address, k]));
    return {
      agents: agents().map((a) => {
        const k = terms.get(a.address);
        return `${a.address}:${a.status}:${cwd.get(a.pane) ?? ""}:${k?.turn ?? ""}:${k?.labels?.[ADDRESSED_LABEL] ?? ""}`;
      }).join("|"),
      spaces: spaces().map((s) => s.folder).join("|"),
    };
  }

  // Events always count; the fallback waits for the window, since no one reads the cards behind other apps.
  watchLive(cx) {
    const ps = panes(), now = this.liveSigns(ps), was = this.live, running = runningCommands(ps);
    const repos = endedFolders(this.commands, running).map((f) => repoOf(f, this.tops.values())).filter(Boolean);
    for (const top of repos) this.dirty.add(top);
    this.live = now;
    this.commands = running;
    const at = Date.now(), active = window()?.active !== false;
    if (now.agents !== was.agents || repos.length || isDue(this.localAt, LOCAL_EVERY, at, active)) this.scanLocal(cx);
    if (now.spaces !== was.spaces || isDue(this.treesAt, TREES_EVERY, at, active)) this.scanTrees(cx);
  }

  // The git folders of the repos with a resting agent; a linked worktree shares its checkout's.
  async watchRepos(tops, cx) {
    const dirs = new Set();
    for (const top of tops) {
      if (!this.gitDirs.has(top)) {
        const r = await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: top });
        this.gitDirs.set(top, r.code === 0 ? r.stdout.trim() : "");
      }
      if (this.gitDirs.get(top)) dirs.add(this.gitDirs.get(top));
    }
    this.wanted = dirs;
    for (const dir of dirs) this.watchRepo(dir, cx);
  }

  watchRepo(dir, cx) {
    if (this.looping.has(dir)) return;
    this.looping.add(dir);
    cx.spawn(async (cx) => {
      try {
        while (this.wanted.has(dir)) {
          const changed = await watchFolder(dir);
          if (!this.wanted.has(dir) || !gitStateChanged(dir, changed)) continue;
          await cx.sleep(WATCH_SETTLE);
          for (const [top, d] of this.gitDirs) if (d === dir) this.dirty.add(top);
          this.scanLocal(cx);
        }
      } catch {
        // The folder is gone; the next scan watches it again if a repo still uses it.
      } finally {
        this.looping.delete(dir);
      }
    });
  }
}
