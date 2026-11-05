import * as fs from "fs/promises";
import { appHome, exec } from "herdr";

const SVG = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  open: SVG(`<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>`),
  draft: SVG(`<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6v2M18 11v2" /><line x1="6" x2="6" y1="9" y2="21"/>`),
  merged: SVG(`<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>`),
  closed: SVG(`<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="6" x2="6" y1="9" y2="15"/><path d="m15 9 6 6M21 9l-6 6"/>`),
  check: SVG(`<path d="m5 12 5 5 9-10"/>`),
  x: SVG(`<path d="M18 6 6 18M6 6l12 12"/>`),
  eye: SVG(`<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>`),
  user: SVG(`<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`),
  external: SVG(`<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>`),
  close: SVG(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),
  copy: SVG(`<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>`),
  tag: SVG(`<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>`),
  commit: SVG(`<circle cx="12" cy="12" r="3"/><line x1="3" x2="9" y1="12" y2="12"/><line x1="15" x2="21" y1="12" y2="12"/>`),
  link: SVG(`<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>`),
  pencil: SVG(`<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>`),
  file: SVG(`<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>`),
  branch: SVG(`<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>`),
  dot: SVG(`<circle cx="12" cy="12" r="4" fill="currentColor"/>`),
  comment: SVG(`<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`),
  alert: SVG(`<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>`),
  search: SVG(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`),
  "chev-r": SVG(`<path d="m9 6 6 6-6 6"/>`),
  "chev-d": SVG(`<path d="m6 9 6 6 6-6"/>`),
  back: SVG(`<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>`),
  behind: SVG(`<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>`),
  pin: SVG(`<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>`),
  refresh: SVG(`<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`),
};

let written = null;

export function icons() {
  written ??= (async () => {
    const dir = `${appHome()}/data/prs/icons`;
    await fs.mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(ICONS)) await fs.writeFile(`${dir}/${name}.svg`, body);
  })();
  return written;
}

export const icon = (name) => `data/prs/icons/${name}.svg`;

// GitHub avatars, downloaded once per login into the data folder.
const avatars = {};
const avatarFile = (login) => `data/prs/avatars/${login.replace(/[^\w-]/g, "_")}.png`;

export const avatarPath = (login) => avatars[login] === "ready" ? avatarFile(login) : null;

// Starts the download the first time a login is asked for: a promise that resolves true once it's ready.
export function loadAvatar(login, url) {
  if (avatars[login] !== undefined) return null;
  if (!url && /^app\/|\[bot\]$/.test(login)) { avatars[login] = "missing"; return null; }
  avatars[login] = "loading";
  return (async () => {
    const path = `${appHome()}/${avatarFile(login)}`;
    if (!await fs.exists(path)) {
      await fs.mkdir(`${appHome()}/data/prs/avatars`, { recursive: true });
      const r = await exec("curl", ["-sfL", "--max-time", "10", "-o", path, url ?? `https://github.com/${login}.png?size=80`]).catch(() => null);
      if (r?.code !== 0) { avatars[login] = "missing"; return false; }
    }
    avatars[login] = "ready";
    return true;
  })();
}
