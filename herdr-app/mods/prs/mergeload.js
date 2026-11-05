// The merge box's data from gh and git (read-only); the pure shaping is in merge.js.
import { exec } from "herdr";
import { parseMergeTree, bothSides } from "./merge.js";

const FIELDS = "squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed,deleteBranchOnMerge,viewerDefaultMergeMethod,viewerPermission";

async function gh(args, on) {
  const r = await exec("gh", args, { on });
  if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim());
  return r.stdout;
}

export async function repoSettings(repo, on) { return JSON.parse(await gh(["repo", "view", repo, "--json", FIELDS], on)); }

// Ahead/behind of the head against the base, and the base tip that conflicts are computed against (not the PR's baseRefOid).
export async function compare(repo, pr, on) {
  const head = pr.isCrossRepository ? `${pr.headRepositoryOwner?.login}:${pr.headRefName}` : pr.headRefOid;
  const out = await gh(["api", `repos/${repo}/compare/${encodeURI(pr.baseRefName)}...${encodeURI(head)}?per_page=1`, "--jq", "{ahead: .ahead_by, behind: .behind_by, baseSha: .base_commit.sha, mb: .merge_base_commit.sha}"], on);
  return { ...JSON.parse(out), headOid: pr.headRefOid, at: Date.now() };
}

// The files that conflict: git merge-tree in the local clone, else the files both branches changed (approximate).
export async function conflictFiles(repo, pr, cmp, cwd, on) {
  if (cwd) {
    try {
      const git = (args) => exec("git", args, { cwd, on });
      const has = async () => (await Promise.all([cmp.baseSha, pr.headRefOid].map((s) => git(["cat-file", "-e", `${s}^{commit}`])))).every((r) => r.code === 0);
      // A PR's head is only reachable as refs/pull/N/head (forks too); fetching leaves FETCH_HEAD and objects, no branches.
      if (!await has()) await git(["fetch", "--no-tags", "origin", pr.baseRefName, `refs/pull/${pr.number}/head`]);
      if (await has()) {
        const r = await git(["merge-tree", "--write-tree", "--name-only", "--no-messages", cmp.baseSha, pr.headRefOid]);
        const parsed = parseMergeTree(r.stdout, r.code);
        if (parsed) return { files: parsed.files, approx: false };
      }
    } catch { /* falls through to the REST estimate */ }
  }
  try {
    const out = await gh(["api", `repos/${repo}/compare/${cmp.mb}...${cmp.baseSha}?per_page=1`, "--jq", "[.files[].filename]"], on);
    return { files: bothSides((pr.files ?? []).map((f) => f.path), JSON.parse(out)), approx: true };
  } catch { return { files: [], approx: false }; }
}
