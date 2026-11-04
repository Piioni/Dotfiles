export const LOCAL_EVERY = 60000;
export const TREES_EVERY = 600000;
// Under LOCAL_EVERY, so a fallback scan always finds the last read expired.
export const STATS_FOR = LOCAL_EVERY - 5000;

export const isDue = (last, every, now, active) => active && now - last >= every;

// Panes running a command in front of their shell: pane -> folder.
export const runningCommands = (panes) => new Map(panes
  .filter((p) => p.terminal && p.cwd && p.status == null && !p.program?.shell && !p.program?.agent)
  .map((p) => [p.pane, p.cwd]));

export const endedFolders = (before, now) => [...before].filter(([pane]) => !now.has(pane)).map(([, cwd]) => cwd);

export const repoOf = (folder, tops) => [...tops]
  .filter((top) => top && (folder === top || folder.startsWith(`${top}/`)))
  .sort((a, b) => b.length - a.length)[0] ?? null;

// What a commit, checkout, add or stash rewrites; new objects and locks aren't news on their own.
const STATE_FILES = new Set(["HEAD", "index", "packed-refs", "MERGE_HEAD"]);
export const gitStateChanged = (dir, paths) => paths.some((path) => {
  if (path === dir) return true;
  if (path.endsWith(".lock")) return false;
  const inside = path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path;
  return STATE_FILES.has(inside.split("/").pop()) || inside.startsWith("refs/");
});
