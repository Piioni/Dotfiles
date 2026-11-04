import * as fs from "fs/promises";
import { appHome } from "herdr";

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
