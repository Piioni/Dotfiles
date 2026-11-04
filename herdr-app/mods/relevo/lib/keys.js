const GLYPHS = [["ctrl", "⌃"], ["alt", "⌥"], ["shift", "⇧"], ["cmd", "⌘"]];

// keys.json's global section turned around: action -> its first key combo.
export function keyMap(global) {
  const map = {};
  for (const [combo, action] of Object.entries(global)) map[action] ??= combo;
  return map;
}

// Relevo's keys live in its layout's section, which wins over global as it does in Herdr.
export const relevoKeys = (file) => ({ ...keyMap(file.global ?? {}), ...keyMap(file["layout:relevo"] ?? {}) });

// "cmd-alt-shift-w" -> "⌥⇧⌘W", in macOS modifier order.
export function formatShortcut(combo) {
  if (!combo) return "";
  const parts = combo.split("-"), key = parts.pop();
  return GLYPHS.filter(([m]) => parts.includes(m)).map(([, g]) => g).join("") + (key.length === 1 ? key.toUpperCase() : key);
}
