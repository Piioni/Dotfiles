import * as fs from "fs/promises";
import { appHome, exec } from "herdr";

// Herdr draws images only from real folders, and this mod's folder may be a
// symlink to its git checkout: icons and avatars go to its data folder instead.
const SVG = (paths) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const ICONS = {
  issue: SVG(`<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/>`),
  refresh: SVG(`<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`),
  done: SVG(`<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>`),
  skipped: SVG(`<circle cx="12" cy="12" r="10"/><line x1="9" x2="15" y1="15" y2="9"/>`),
  tag: SVG(`<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>`),
  user: SVG(`<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`),
  pencil: SVG(`<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>`),
  link: SVG(`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`),
  commit: SVG(`<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>`),
  milestone: SVG(`<path d="M12 13v8"/><path d="M12 3v3"/><path d="M18 6a2 2 0 0 1 1.387.56l2.307 2.22a1 1 0 0 1 0 1.44l-2.307 2.22A2 2 0 0 1 18 13H6a2 2 0 0 1-1.387-.56l-2.306-2.22a1 1 0 0 1 0-1.44l2.306-2.22A2 2 0 0 1 6 6z"/>`),
  pull: SVG(`<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>`),
  external: SVG(`<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`),
  close: SVG(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),
  copy: SVG(`<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`),
  back: SVG(`<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>`),
};

let written = null;

// Resolves once the icons are on disk; draw them only after that.
export function icons() {
  written ??= (async () => {
    const dir = `${appHome()}/data/issues/icons`;
    await fs.mkdir(dir, { recursive: true });
    for (const [name, svg] of Object.entries(ICONS)) await fs.writeFile(`${dir}/${name}.svg`, svg);
  })();
  return written;
}

export const icon = (name) => `data/issues/icons/${name}.svg`;

// GitHub avatars, downloaded once per login into the data folder.
const avatars = {};
const file = (login) => `data/issues/avatars/${login.replace(/[^\w-]/g, "_")}.png`;

// The picture to draw, or null while there's none (yet).
export const avatarPath = (login) => avatars[login] === "ready" ? file(login) : null;

// Starts the download the first time a login is asked for: a promise that
// resolves true once its picture is ready. Bots without a URL have none.
export function loadAvatar(login, url) {
  if (avatars[login] !== undefined) return null;
  if (!url && /^app\/|\[bot\]$/.test(login)) { avatars[login] = "missing"; return null; }
  avatars[login] = "loading";
  return (async () => {
    const path = `${appHome()}/${file(login)}`;
    if (!await fs.exists(path)) {
      await fs.mkdir(`${appHome()}/data/issues/avatars`, { recursive: true });
      const r = await exec("curl", ["-sfL", "--max-time", "10", "-o", path, url ?? `https://github.com/${login}.png?size=80`]).catch(() => null);
      if (r?.code !== 0) { avatars[login] = "missing"; return false; }
    }
    avatars[login] = "ready";
    return true;
  })();
}
