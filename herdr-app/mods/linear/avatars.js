import * as fs from "fs/promises";
import { appHome, exec } from "herdr";

// People's pictures, downloaded once per URL into the data folder: the app draws images only from real files.
const state = {};
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 2166136261).toString(16);
const file = (url) => `data/linear/avatars/${hash(url)}.png`;

export const avatarPath = (url) => (state[url] === "ready" ? file(url) : null);

// Starts the download the first time a URL is asked for: a promise that resolves true once it's ready.
export function loadAvatar(url) {
  if (!url || state[url] !== undefined) return null;
  state[url] = "loading";
  return (async () => {
    const path = `${appHome()}/${file(url)}`;
    if (!await fs.exists(path)) {
      await fs.mkdir(`${appHome()}/data/linear/avatars`, { recursive: true });
      const r = await exec("curl", ["-sfL", "--max-time", "10", "-o", path, url]).catch(() => null);
      if (r?.code !== 0) { state[url] = "missing"; return false; }
    }
    state[url] = "ready";
    return true;
  })();
}
