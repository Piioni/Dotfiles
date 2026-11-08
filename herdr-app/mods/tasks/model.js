// Pure data shaping for the tasks mod: no herdr, no exec, so it can be tested with node alone.

// `git worktree list --porcelain`: the main checkout comes first. Bare entries and prunable ones
// (their folder is gone) are left out, so a deleted worktree stops counting as one.
export function parseWorktrees(porcelain) {
  return porcelain.split(/\n\s*\n/).map((block) => {
    const path = block.match(/^worktree (.+)$/m)?.[1];
    if (!path || /^bare$/m.test(block) || /^prunable/m.test(block)) return null;
    return { path, branch: block.match(/^branch refs\/heads\/(.+)$/m)?.[1] ?? null };
  }).filter(Boolean);
}

// The worktree as it reads best: the main checkout by its folder, the others without the repo's prefix.
export function wtName(path, main) {
  const b = path.split("/").pop(), m = (main ?? "").split("/").pop();
  return path === main || !b.startsWith(`${m}.`) ? b : b.slice(m.length + 1);
}

// A header pattern is matched line by line, ignoring case; null when it is not a valid regex.
export function compile(src) {
  try { return new RegExp(src, "im"); } catch { return null; }
}

// The `# name:`, `# ready:`, `# reload:` and `# busy:` lines among a script's first eight.
// A ready or busy pattern that is not a valid regex is dropped and reported in `problems`.
export function parseHeader(text, fallbackName) {
  const head = text.split(/\r?\n/).slice(0, 8);
  const get = (key) => head.map((l) => l.match(new RegExp(`^#\\s*${key}:\\s*(\\S.*)$`, "i"))?.[1]).find(Boolean)?.trim();
  const problems = [];
  const pattern = (key) => {
    const src = get(key);
    if (src && !compile(src)) { problems.push(`# ${key}: is not a valid regex`); return undefined; }
    return src;
  };
  return { name: get("name") ?? fallbackName, ready: pattern("ready"), reload: get("reload")?.split(/\s+/)[0], busy: pattern("busy"), problems };
}

// A copy of a shared map without some keys. Callers pass the map as it is NOW, not one read before
// an await, so an entry another copy added in the meantime is not lost.
export function dropKeys(map, keys) {
  const out = { ...map };
  for (const k of keys) delete out[k];
  return out;
}

// Why a command failed, for a toast: the message of an hc JSON error, else the first line of its output.
export function failure(out) {
  const text = (out ?? "").trim();
  try { const msg = JSON.parse(text).error?.message; if (msg) return msg; } catch {}
  return text.split("\n")[0];
}
