import { exec, home, notify, spaces, panes, window } from "herdr";
import { REPOS_ROOT as ROOT } from "./config.js";
import { mergedHeads } from "./lib/github.js";
import { GIT_READ } from "./lib/git.js";

/** @typedef {{main:string, path:string, branch?:string, locked?:boolean, missing?:boolean, at?:number, repo?:string, name?:string, space?:string|null, open?:boolean, merged?:boolean, dirty?:boolean, ignored?:string[]}} Worktree */

// Every linked worktree of the clones in ROOT, as "<main>\t<porcelain line>".
const LIST = 'for d in "$1"/*/; do [ -d "$d.git" ] || continue; git -C "$d" worktree list --porcelain 2>/dev/null | awk -v d="${d%/}" \'{ print d "\t" $0 }\'; done';

/** @param {string} out @returns {Worktree[]} */
function parse(out) {
  const list = [];
  /** @type {Worktree|null} */
  let cur = null;
  for (const line of out.split("\n")) {
    const [main, rest = ""] = line.split("\t");
    if (rest.startsWith("worktree ")) {
      cur = { main, path: rest.slice(9) };
      if (cur.path !== main) list.push(cur);
    } else if (cur && rest.startsWith("branch refs/heads/")) cur.branch = rest.slice(18);
    else if (cur && (rest === "locked" || rest.startsWith("locked "))) cur.locked = true;
    else if (cur && (rest === "prunable" || rest.startsWith("prunable "))) cur.missing = true;
  }
  return list;
}

// "<path>\t<newest of last commit, index and HEAD>": the index moves with any git use there.
function touchedCommand() {
  const stat = window()?.platform === "macos" ? "-f %m" : "-c %Y";
  return 'for w; do g=$(git -C "$w" rev-parse --absolute-git-dir 2>/dev/null) || continue; c=$(git -C "$w" log -1 --format=%ct 2>/dev/null); m=$(stat ' + stat + ' "$g/index" "$g/HEAD" 2>/dev/null | sort -n | tail -1); printf "%s\t%s\n" "$w" "$(printf "%s\n%s\n" "${c:-0}" "${m:-0}" | sort -n | tail -1)"; done';
}

/** @param {string} url */
const slug = (url) => /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url.trim())?.[1] ?? null;

// GitHub's merged PRs per repo, asked again after MERGED_TTL or on a forced refresh;
// scans also run on every space change, and this is the network call in them.
const MERGED_TTL = 15 * 60 * 1000;
const mergedOnGitHub = new Map();

/** @param {string} main @param {boolean} force */
async function githubMerged(main, force) {
  const hit = mergedOnGitHub.get(main);
  if (hit && !force && Date.now() - hit.at < MERGED_TTL) return hit.branches;
  const branches = new Set();
  const repo = slug((await exec("git", ["-C", main, "remote", "get-url", "origin"])).stdout);
  if (repo) {
    const r = await exec("gh", ["pr", "list", "-R", repo, "--state", "merged", "--limit", "100", "--json", "headRefName,isCrossRepository"]);
    if (r.code !== 0) return hit?.branches ?? branches;
    try { for (const name of mergedHeads(JSON.parse(r.stdout))) branches.add(name); }
    catch { throw new Error("Invalid GitHub merged pull request response"); }
  }
  mergedOnGitHub.set(main, { at: Date.now(), branches });
  return branches;
}

// Branches whose PR merged on GitHub, and local branches whose upstream is gone (local, so always fresh).
/** @param {string} main @param {boolean} force */
async function mergedBranches(main, force) {
  const out = new Set(await githubMerged(main, force));
  const refs = await exec("git", ["-C", main, "for-each-ref", "--format=%(refname:short)\t%(upstream:track)", "refs/heads"]);
  for (const l of refs.stdout.split("\n")) if (l.endsWith("[gone]")) out.add(l.split("\t")[0]);
  return out;
}

/** @param {boolean} [force=false] */
export async function scanWorktrees(force = false) {
  const list = parse((await exec("sh", ["-c", LIST, "sh", `${home()}/${ROOT}`])).stdout).filter((w) => !w.missing);
  const open = new Set([...spaces().map((s) => s.folder), ...panes().map((p) => p.cwd)].filter(Boolean));
  const merged = /** @type {Record<string,Set<string>>} */ ({});
  for (const main of new Set(list.map((w) => w.main))) merged[main] = await mergedBranches(main, force);
  const touched = new Map((await exec("sh", ["-c", touchedCommand(), "sh", ...list.map((w) => w.path)])).stdout
    .split("\n").filter(Boolean).map((l) => {
      const [path, at] = l.split("\t");
      return /** @type {[string,string]} */ ([path, at]);
    }));
  for (const w of list) {
    w.at = Number(touched.get(w.path)) || 0;
    w.repo = w.main.split("/").pop();
    w.name = w.path.split("/").pop();
    w.space = spaces().find((s) => !s.machine && s.folder === w.path)?.id ?? null;
    w.open = [...open].some((p) => p === w.path || p.startsWith(`${w.path}/`));
    w.merged = Boolean(w.branch && merged[w.main].has(w.branch));
    if (w.merged) {
      w.dirty = (await statusOf(w)).stdout.trim() !== "";
      w.ignored = worthKeeping((await ignoredFiles(w)).paths);
    }
  }
  return list.sort((a, b) => b.at - a.at);
}

// Only what an install or a tool always brings back. "build" or "out" can hold someone's work, so those get named.
const REBUILT = new Set(["node_modules", ".build", "__pycache__", ".pytest_cache", ".next", ".nuxt", ".turbo", ".gradle", ".venv", "DerivedData", ".DS_Store"]);
/** @param {Worktree} w */
const ignoredFiles = async (w) => {
  const r = await exec("git", [...GIT_READ, "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory"], { cwd: w.path });
  return { ...r, paths: r.stdout.split("\0").filter(Boolean).map((l) => l.replace(/\/$/, "")) };
};
// git also lists the folders holding ignored entries; only the entries themselves count.
/** @param {string[]} paths */
const worthKeeping = (paths) => paths.filter((l) => !REBUILT.has(l.split("/").pop()) && !paths.some((o) => o.startsWith(`${l}/`)));
// showUntrackedFiles=no would hide new files from this check and from git's own refusal.
/** @param {Worktree} w */
const statusOf = (w) => exec("git", [...GIT_READ, "status", "--porcelain", "--untracked-files=normal"], { cwd: w.path });

/** @param {Worktree} w */
async function isLocked(w) {
  const out = (await exec("git", ["-C", w.main, "worktree", "list", "--porcelain"])).stdout;
  return out.split("\n\n").some((b) => b.split("\n")[0] === `worktree ${w.path}` && /^locked\b/m.test(b));
}

// Looks again right before removing, since the last scan can be minutes old and closing a space can't be undone.
/** @param {Worktree} w */
export async function removalCheck(w) {
  try {
    /** @param {string|undefined} p */
    const inside = (p) => p === w.path || p?.startsWith(`${w.path}/`);
    const space = spaces().find((s) => !s.machine && s.folder === w.path);
    const own = new Set((space?.tabs ?? []).map((t) => t.id));
    const here = panes().filter((p) => inside(p.cwd));
    // A space's own terminals close with it; any other would lose its folder.
    if (here.some((p) => !own.has(p.tab))) return { error: "open in a terminal" };
    if (here.some((p) => p.status === "working")) return { error: "an agent is working here" };
    if (await isLocked(w)) return { error: "locked" };
    /** @param {string[]} args */
    const git = (args) => exec("git", [...GIT_READ, ...args], { cwd: w.path });
    const tracked = await git(["ls-files", "--stage", "-v"]);
    if (tracked.code !== 0) return { error: "could not check its files" };
    const rows = tracked.stdout.split("\n").filter(Boolean);
    // git refuses a worktree with submodules, and only after the space would have closed.
    if (rows.some((l) => /^\S+ 160000 /.test(l))) return { error: "has submodules" };
    if (rows.some((l) => /^[Sa-z]/.test(l))) return { error: "has files git skips" };
    const status = await statusOf(w);
    if (status.code !== 0) return { error: "could not check its files" };
    if (status.stdout.trim()) return { error: "uncommitted changes" };
    const ignored = await ignoredFiles(w);
    if (ignored.code !== 0) return { error: "could not check its files" };
    // Clones under these belong to the tool that made them, like SwiftPM's .build/checkouts.
    const dirs = ignored.paths.filter((p) => !REBUILT.has(p.split("/").pop())).map((p) => `./${p}`);
    const skip = [...REBUILT].flatMap((name, i) => (i ? ["-o", "-name", name] : ["-name", name]));
    const nested = dirs.length ? await exec("find", [...dirs, "(", ...skip, ")", "-prune", "-o", "-name", ".git", "-print"], { cwd: w.path }) : { code: 0, stdout: "" };
    if (nested.code !== 0) return { error: "could not check its files" };
    const repo = nested.stdout.split("\n").find(Boolean);
    if (repo) return { error: `holds a repo: ${repo.replace(/^\.\//, "").replace(/\/?\.git$/, "")}` };
    return { space: space?.id ?? null, ignored: worthKeeping(ignored.paths) };
  } catch {
    return { error: "could not check its files" };
  }
}

// Never forced: git keeps a worktree with changes, and -d keeps a branch with unmerged commits.
/** @param {Worktree} w */
export async function removeWorktree(w) {
  const r = await exec("git", ["-C", w.main, "worktree", "remove", w.path]);
  if (r.code !== 0) return r.stderr.trim().split("\n")[0] || "git worktree remove failed";
  if (w.branch) {
    const b = await exec("git", ["-C", w.main, "branch", "-d", w.branch]);
    if (b.code !== 0) notify({ title: `Kept branch ${w.branch}`, body: b.stderr.trim().split("\n")[0], level: "warning" });
  }
  return null;
}

// Where a branch is checked out: the clone itself or one of its worktrees; null when nowhere.
/** @param {string} clone @param {string} branch */
export async function checkoutOf(clone, branch) {
  const out = (await exec("git", ["-C", clone, "worktree", "list", "--porcelain"])).stdout;
  let path = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) path = line.slice(9);
    else if (line === `branch refs/heads/${branch}`) return path;
  }
  return null;
}

// When each checkout was last used: path -> seconds (newest of its last commit, index and HEAD).
/** @param {string[]} paths */
export async function touchedAt(paths) {
  if (!paths.length) return new Map();
  const out = (await exec("sh", ["-c", touchedCommand(), "sh", ...paths])).stdout;
  return new Map(out.split("\n").filter(Boolean).map((l) => {
    const [path, at] = l.split("\t");
    return [path, Number(at) || 0];
  }));
}
