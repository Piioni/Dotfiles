/** @typedef {"linux" | "macos" | "windows"} Platform */
/** @param {string} path */
const ps = (path) => `'${path.replaceAll("'", "''")}'`;

/** @param {Platform} platform @param {string} path @returns {[string, string[]]} */
export function statArgs(platform, path) {
  if (platform === "windows") return ["powershell", ["-NoProfile", "-Command", `(Get-Item -LiteralPath ${ps(path)}).Length`]];
  return ["stat", platform === "macos" ? ["-f", "%z", path] : ["-c", "%s", path]];
}

/** @param {Platform} platform @param {string} path @param {boolean} [dir] @returns {[string, string[]]} */
export function trashArgs(platform, path, dir = false) {
  if (platform === "windows") {
    const method = dir ? "DeleteDirectory" : "DeleteFile";
    const args = dir ? `${ps(path)},[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin` : `${ps(path)},[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin`;
    return ["powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::${method}(${args})`]];
  }
  return platform === "macos" ? ["/usr/bin/trash", [path]] : ["gio", ["trash", path]];
}

/** @param {Platform} platform @param {string} path @returns {[string, string[]]} */
export function revealArgs(platform, path) {
  if (platform === "windows") return ["explorer", [`/select,${path}`]];
  if (platform === "macos") return ["open", ["-R", path]];
  const slash = path.lastIndexOf("/");
  return ["xdg-open", [slash < 0 ? "." : slash === 0 ? "/" : path.slice(0, slash)]];
}
