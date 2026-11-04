// config.js as data: rendering it back to source and checking a setup before it is written.

const WIDTH = 130;
const SKILL_KEYS = ["review", "fix", "comments"];
/** @param {string | undefined} path */
const safeFolder = (path) => typeof path === "string" && !!path.trim() && !/^[\\/~]/.test(path) && !/[\\\0\r\n]/.test(path) && !path.split("/").includes("..");
const ACCOUNT_FIELDS = ["key", "label", "letter", "launcher", "bg", "fg"];

// sh -c WRITE_SCRIPT sh <path> <text>: a hidden temp file in the same folder, then one rename,
// so the mod never reloads a half-written config.
export const WRITE_SCRIPT = 'tmp=$(mktemp "$(dirname "$1")/.config.XXXXXX") || exit 1; '
  + 'printf "%s" "$2" > "$tmp" && chmod 644 "$tmp" && mv -f "$tmp" "$1" || { rm -f "$tmp"; exit 1; }';

/** @param {string} label */
export const slug =(label) => (label ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** @param {string} text */
export const parseList = (text) => (text ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** @param {string} c */
export const isHex = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c ?? "");

/** @param {string} k */
const keyText = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

/** @param {any} v @returns {string} */
function value(v) {
  if (Array.isArray(v)) return `[${v.map(value).join(", ")}]`;
  if (v && typeof v === "object") return `{ ${Object.entries(v).map(([k, x]) => `${keyText(k)}: ${value(x)}`).join(", ")} }`;
  return JSON.stringify(v) ?? "undefined";
}

// One line when it fits, else its fields packed onto lines under WIDTH, like config.example.js.
/** @param {Record<string, any>} obj @param {number} indent @param {string} prefix @param {string} suffix */
function block(obj, indent, prefix, suffix) {
  const pad = " ".repeat(indent);
  const line = `${pad}${prefix}${value(obj)}${suffix}`;
  if (line.length <= WIDTH) return line;
  const inner = " ".repeat(indent + 2), rows = [];
  let row = "";
  for (const [k, x] of Object.entries(obj)) {
    const field = `${keyText(k)}: ${value(x)},`;
    if (row && inner.length + row.length + 1 + field.length > WIDTH) {
      rows.push(inner + row);
      row = field;
    } else {
      row = row ? `${row} ${field}` : field;
    }
  }
  if (row) rows.push(inner + row);
  return [`${pad}${prefix}{`, ...rows, `${pad}}${suffix}`].join("\n");
}

/** @param {string} name @param {Array<Record<string, any>>} items */
const list = (name, items) => [`export const ${name} = [`, ...items.map((o) => block(o, 2, "", ",")), "];"].join("\n");

/** @param {string} name @param {any} v */
const flat = (name, v) => {
  const line = `export const ${name} = ${value(v)};`;
  if (line.length <= WIDTH || !Array.isArray(v)) return line;
  return [`export const ${name} = [`, ...v.map((x) => `  ${value(x)},`), "];"].join("\n");
};

/** @param {Record<string, any>} c */
export function renderConfig(c) {
  const names = ["ACCOUNTS", "CODEX", "LAUNCHERS", "REPOS_ROOT", "SKILLS"];
  const keys = [...names.filter((k) => k in c), ...Object.keys(c).filter((k) => !names.includes(k))];
  return ["// Relevo Settings: provider accounts, named launch profiles and slash commands.", "",
    ...keys.flatMap((name) => {
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`Invalid config export: ${name}`);
      const data = c[name];
      return [Array.isArray(data) && data.every((v) => v && typeof v === "object")
        ? list(name, data)
        : data && !Array.isArray(data) && typeof data === "object"
          ? block(data, 0, `export const ${name} = `, ";") : flat(name, data), ""];
    })].join("\n");
}

// Errors as { at, message }; `at` names the field ("accounts.1.bg", "codex.launcher", "skills").
/** @param {Record<string, any>} c @returns {Array<{at:string,message:string}>} */
export function validate(c) {
  const errors = /** @type {Array<{at:string,message:string}>} */ ([]);
  /** @param {string} at @param {string} message */
  const fail = (at, message) => errors.push({ at, message });
  const modern = Array.isArray(c.LAUNCHERS);
  const fields = modern ? ACCOUNT_FIELDS.filter((f) => f !== "launcher") : ACCOUNT_FIELDS;
  const accounts = /** @type {Array<Record<string, any>>} */ (c.ACCOUNTS ?? []);
  if (!accounts.length) fail("accounts", "Add at least one account");
  const seen = new Set();
  accounts.forEach((a, i) => {
    const name = a.label || `Account ${i + 1}`;
    for (const field of [...fields, "claudeDir"]) {
      if (!a[field]?.trim()) fail(`accounts.${i}.${field}`, `${name}: ${field} is required`);
    }
    if (a.key && !/^[A-Za-z0-9_-]+$/.test(a.key)) fail(`accounts.${i}.key`, `${name}: the key takes letters, digits and dashes`);
    else if (a.key && (seen.has(a.key) || a.key === c.CODEX?.key)) fail(`accounts.${i}.key`, `${name}: key "${a.key}" is taken`);
    seen.add(a.key);
    if (a.letter && [...a.letter].length > 2) fail(`accounts.${i}.letter`, `${name}: the letter is one or two characters`);
    for (const field of ["bg", "fg"]) {
      if (a[field] && !isHex(a[field])) fail(`accounts.${i}.${field}`, `${name}: ${field} is a hex color like #1e2030`);
    }
  });
  for (const field of fields) if (!c.CODEX?.[field]?.trim()) fail(`codex.${field}`, `Codex: ${field} is required`);
  const root = c.REPOS_ROOT ?? "";
  if (!root.trim()) fail("reposRoot", "Repos root is required");
  else if (root.startsWith("/") || root.startsWith("~")) fail("reposRoot", "Repos root is relative to home, like code");
  const skills = c.SKILLS ?? {};
  if (Object.keys(skills).sort().join() !== [...SKILL_KEYS].sort().join()) fail("skills", "Skills: review, fix and comments");
  for (const k of SKILL_KEYS) if (k in skills && !skills[k]?.trim()) fail(`skills.${k}`, `Skills: ${k} is required`);
  if (modern) {
    const launchers = /** @type {Array<Record<string, any>>} */ (c.LAUNCHERS);
    if (!launchers.length) fail("launchers", "Add at least one launcher");
    const ids = new Set();
    launchers.forEach((l, i) => {
      const at = `launchers.${i}`, name = l.label || `Launcher ${i + 1}`;
      if (!/^[A-Za-z0-9_-]+$/.test(l.key ?? "") || ids.has(l.key)) fail(`${at}.key`, `${name}: use a unique stable key`);
      ids.add(l.key);
      for (const k of ["label", "command", "profile"]) if (!l[k]?.trim()) fail(`${at}.${k}`, `${name}: ${k} is required`);
      if (! ["claude", "pi", "codex"].includes(l.app)) fail(`${at}.app`, `${name}: choose Claude, Pi or Codex`);
      if (l.app === "claude" && !safeFolder(l.claudeDir)) fail(`${at}.claudeDir`, `${name}: Claude profile folder must be relative to home, without ..`);
      if (l.app === "pi" && l.account) fail(`${at}.account`, `${name}: Pi selects its provider with its model`);
      if (l.account && ![...seen, c.CODEX?.key].includes(l.account)) fail(`${at}.account`, `${name}: select an existing account`);
      if (l.app === "claude" && l.account === c.CODEX?.key) fail(`${at}.account`, `${name}: select a Claude account`);
      if (l.app === "codex" && l.account && l.account !== c.CODEX?.key) fail(`${at}.account`, `${name}: select the Codex account`);
    });
  }
  accounts.forEach((a, i) => { if (!safeFolder(a.claudeDir)) fail(`accounts.${i}.claudeDir`, "Credential folder must be relative to home, without .."); });
  if (!safeFolder(root)) fail("reposRoot", "Repos root must stay under home, without ..");
  return errors;
}

// What a Log in tab runs: Claude with that account's folder (the normal ~/.claude uses the default lookup, since
// naming it makes Claude start its first-run setup), or Codex's own login. The folder is a positional argument, never shell text.
/** @param {"claude" | "codex"} app @param {string} [claudeDir] @returns {string[] | null} */
export function loginArgv(app, claudeDir) {
  if (app === "codex") return ["bash", "-ilc", "codex login"];
  if (!safeFolder(claudeDir)) return null;
  return claudeDir === ".claude"
    ? ["bash", "-ilc", "env -u CLAUDE_CONFIG_DIR claude"]
    : ["bash", "-ilc", 'env CLAUDE_CONFIG_DIR="$HOME/$1" claude', "bash", /** @type {string} */ (claudeDir)];
}
