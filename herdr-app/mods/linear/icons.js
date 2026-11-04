import * as fs from "fs/promises";
import { appHome } from "herdr";

// Herdr draws images only from real folders, so the icons are written to the data folder once.
const SVG = (body, extra = "") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;
const bars = (n) => [0, 1, 2].map((i) => `<rect x="${3 + i * 7}" y="${15 - i * 5}" width="4" height="${6 + i * 5}" rx="1" ${i < n ? 'fill="currentColor"' : 'opacity=".3" fill="currentColor"'} stroke="none"/>`).join("");
const ICONS = {
  backlog: SVG(`<circle cx="12" cy="12" r="9" stroke-dasharray="3 3.2"/>`),
  unstarted: SVG(`<circle cx="12" cy="12" r="9"/>`),
  started: SVG(`<circle cx="12" cy="12" r="9"/><path d="M12 7a5 5 0 0 1 0 10z" fill="currentColor" stroke="none"/>`),
  completed: SVG(`<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".18"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>`),
  canceled: SVG(`<circle cx="12" cy="12" r="9" fill="currentColor" fill-opacity=".18"/><path d="m9 9 6 6M15 9l-6 6"/>`),
  p0: SVG(`<path d="M4 12h3M10.5 12h3M17 12h3" opacity=".5"/>`),
  p1: SVG(`<rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" stroke="none"/><path d="M12 7.5v6M12 16.5v.01" stroke="#000" stroke-opacity=".75"/>`),
  p2: SVG(bars(3)), p3: SVG(bars(2)), p4: SVG(bars(1)),
  "chev-r": SVG(`<path d="m9 6 6 6-6 6"/>`),
  "chev-d": SVG(`<path d="m6 9 6 6 6-6"/>`),
  pull: SVG(`<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>`),
  refresh: SVG(`<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>`),
  sliders: SVG(`<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>`),
  check: SVG(`<path d="M20 6 9 17l-5-5"/>`),
  "chev-u": SVG(`<path d="m18 15-6-6-6 6"/>`),
  back: SVG(`<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>`),
  swap: SVG(`<path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/>`),
  grip: SVG(`<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></g>`),
  eye: SVG(`<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>`),
  "eye-off": SVG(`<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>`),
  task: SVG(`<circle cx="12" cy="12" r="9"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/>`),
  branch: SVG(`<line x1="6" x2="6" y1="3" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>`),
  key: SVG(`<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>`),
};

let written = null;

export function icons() {
  written ??= (async () => {
    const dir = `${appHome()}/data/linear/icons`;
    await fs.mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(ICONS)) await fs.writeFile(`${dir}/${name}.svg`, body);
  })();
  return written;
}

export const icon = (name) => `data/linear/icons/${name}.svg`;
const STATUS = { triage: "unstarted", duplicate: "canceled" };
export const statusName = (type) => STATUS[type] ?? (["backlog", "unstarted", "started", "completed", "canceled"].includes(type) ? type : "unstarted");
export const statusIcon = (type) => icon(statusName(type));
export const priorityIcon = (p) => icon(`p${p}`);
