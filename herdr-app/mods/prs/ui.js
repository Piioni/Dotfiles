// Small pieces every part of the dialog draws the same way: theme tones (never fixed hex), hairlines, label chips, review verdicts.
import { div } from "gpui-kit";

// ok=green, bad=red, warn=amber, review=blue, merged=purple, neutral=muted, link=accent: the same tones as the list panel.
/** @param {any} t @param {string} k @returns {string} */
export const tone = (t, k) => ({ ok: t.ansi2, bad: t.ansi1, warn: t.ansi3, review: t.ansi4, merged: t.ansi5, neutral: t.muted, link: t.accent })[/** @type {"ok"} */ (k)];
/** @param {any} t */
export const hairline = (t) => div().h(1).flex_none().bg(t.border).opacity(0.5);
/** @param {number} n @param {string} word */
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// What a review says: [sentence, glyph, tone]; keys are the timeline's (lower case) and gh's (upper case).
/** @type {Record<string, [string, string, string | null]>} */
const VERDICTS = {
  approved: ["approved these changes", "check", "ok"], changes_requested: ["requested changes", "x", "bad"],
  commented: ["reviewed", "comment", null], dismissed: ["had a review dismissed", "x", "neutral"], pending: ["pending", "dot", "warn"],
};
/** @param {string} state @param {any} t @returns {[string, string, string]} */
export const verdict = (state, t) => {
  const [text, glyph, k] = VERDICTS[String(state).toLowerCase()] ?? VERDICTS.commented;
  return [text, glyph, k ? tone(t, k) : t.muted];
};

// A label as GitHub tints it: its color faint behind, its color as text unless too dark to read.
/** @param {{ name: string, color: string }} l @param {any} t */
export function labelChip(l, t) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(l.color.slice(i, i + 2), 16));
  const light = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.35;
  return div().h(20).px(7).flex_none().flex().items_center().rounded(10).border_1().border_color(`#${l.color}66`).bg(`#${l.color}2e`)
    .text_size(12).font_semibold().text_color(light ? `#${l.color}` : t.foreground).child(l.name);
}
