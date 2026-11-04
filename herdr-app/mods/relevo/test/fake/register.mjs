// Answers the app's bare imports with these fakes, so tests load the real mods. Import it before a dynamic import of one.
import { registerHooks } from "node:module";
import { URL } from "node:url";

/** @type {Record<string,string>} */
const FAKES = { herdr: "./herdr.mjs", "gpui-kit": "./gpui-kit.mjs", "gpui-base": "./gpui-base.mjs" };

const runtimeConfig = new URL("../../config.js", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL && new URL(specifier, context.parentURL).href === runtimeConfig)
      return { url: new URL("./config.mjs", import.meta.url).href, shortCircuit: true };
    if (FAKES[specifier]) return { url: new URL(FAKES[specifier], import.meta.url).href, shortCircuit: true };
    return next(specifier, context);
  },
});

/** @type {Map<string,string>} */
const stored = new Map();
Object.assign(globalThis, { localStorage: {
  /** @param {string} key */
  getItem(key) { return stored.get(key) ?? null; },
  /** @param {string} key @param {unknown} value */
  setItem(key, value) { stored.set(key, String(value)); },
  /** @param {string} key */
  removeItem(key) { stored.delete(key); },
} });
