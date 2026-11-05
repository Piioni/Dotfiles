import { exec, window } from "herdr";

// "<path>\t<newest of last commit, index and HEAD>": the index moves with any git use there.
function touchedCommand() {
  const stat = window()?.platform === "macos" ? "-f %m" : "-c %Y";
  return 'for w; do g=$(git -C "$w" rev-parse --absolute-git-dir 2>/dev/null) || continue; c=$(git -C "$w" log -1 --format=%ct 2>/dev/null); m=$(stat ' + stat + ' "$g/index" "$g/HEAD" 2>/dev/null | sort -n | tail -1); printf "%s\t%s\n" "$w" "$(printf "%s\n%s\n" "${c:-0}" "${m:-0}" | sort -n | tail -1)"; done';
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
