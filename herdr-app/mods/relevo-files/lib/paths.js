export const PREVIEW_LIMIT = 400000;
/** @type {Record<string, string>} */
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };
/** @param {string} path */
export function languageOf(path) {
  const name = path.split("/").pop() ?? "";
  const ext = name.includes(".") ? name.split(".").pop() : "txt";
  return LANG[ext] ?? ext;
}
/** @param {string} name @param {"linux" | "macos" | "windows"} [platform] */
export function nameError(name, platform) {
  if (!name) return "Type a name";
  if (name === "." || name === "..") return "Not a valid name";
  if (name.includes("/") || name.includes("\0")) return "A name can't contain /";
  if (platform === "windows" && name.includes("\\")) return "A name can't contain \\";
  if (name !== name.trim()) return "Remove leading or trailing spaces";
  return null;
}
/** @param {string} rel */
export const parentOf = (rel) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
/** @param {string} rel */
export const baseName = (rel) => rel.slice(rel.lastIndexOf("/") + 1);
/** @param {...string} parts */
export const join = (...parts) => parts.filter(Boolean).join("/");
/** @param {{path: string, dir: boolean}} entry */
export const targetFolder = ({ path, dir }) => (dir ? path : parentOf(path));
/** @param {string | null | undefined} path @param {string} from @param {string} to */
export function moved(path, from, to) {
  if (path === from) return to;
  if (path?.startsWith(`${from}/`)) return to + path.slice(from.length);
  return path;
}
/** @param {string | null | undefined} path @param {string} folder */
export const isUnder = (path, folder) => path === folder || Boolean(path?.startsWith(`${folder}/`));
export const READ_LIMIT = 1024 * 1024;
/** @param {string | null} text @param {number | null} bytes @returns {{error?: string, value?: string, editable?: boolean}} */
export function textState(text, bytes) {
  if (text === null) return { error: "This file is no longer available" };
  if (text.includes("\0")) return { error: "Binary file · no text preview" };
  if (text.length > PREVIEW_LIMIT) return { value: `${text.slice(0, PREVIEW_LIMIT)}\n… (file truncated)`, editable: false };
  return { value: text, editable: bytes !== null && bytes < READ_LIMIT };
}
