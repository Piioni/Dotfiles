// What a waiting agent is asking, read from the bottom of its screen: the question, its numbered choices,
// whether they are checkboxes, where the cursor is and where a Submit item sits.
const OPTION = /^([❯›>]\s*)?(\d+)\.\s+(.+?)\s*$/;
const SUBMIT = /^([❯›>]\s*)?(Submit|Submit answers)$/i;
const BOX = /^\[([ xX✔✓✗])?\]\s*/;
const FRAME = /^[│┃╭╮╰╯─━┌┐└┘|\s]+|[│┃╭╮╰╯─━┌┐└┘|\s]+$/g;
// Lines between two choices that still belong to the menu: a description, a blank, a separator, Submit.
const MAX_GAP = 4;
// A dialog's top edge is a whole solid line at the margin; a command's lines are indented and a diff is fenced with ╌.
const EDGE = /^[╭┌─━][─━]{2,}[╮┐]?\s*$/;
const PREVIEW = /\s{3,}[┌│└╭╰].*$/;
// A list with no cursor this far above the bottom is old output.
const TAIL = 10;
// Output that moves on its own above a dialog: spinners, timers and tool results.
const STATUS = /^\s*[●⏺•⎿✻✶✢✳✽∗·⠀-⣿]/;

export function readPrompt(screen) {
  const lines = (screen ?? "").split("\n").map((l) => l.replace(FRAME, "")).slice(-60);
  const none = { question: lastLines(lines, 2), options: [], multi: false, submit: null, cursor: null, dialog: "" };
  let last = -1;
  for (let i = lines.length - 1; i >= 0 && last < 0; i--) if (OPTION.test(lines[i])) last = i;
  const noList = () => (unnumberedMenu(screen) ? { ...none, unparsed: true } : none);
  if (last < 0) return noList();
  // Walk up from the last choice to choice 1.
  const found = [{ i: last, n: Number(OPTION.exec(lines[last])[2]) }];
  let gap = 0;
  for (let i = last - 1; i >= 0 && found[0].n > 1 && gap <= MAX_GAP; i--) {
    const m = OPTION.exec(lines[i]);
    if (!m) {
      gap++;
      continue;
    }
    if (Number(m[2]) !== found[0].n - 1) break;
    found.unshift({ i, n: Number(m[2]) });
    gap = 0;
  }
  const marked = found.some(({ i }) => OPTION.exec(lines[i])[1]);
  if (!marked && lines.slice(last + 1).filter((l) => l.trim()).length > TAIL) return noList();
  if (found[0].n !== 1 || found.at(-1).n > 9) return { ...none, unparsed: true };
  let submit = null, cursor = null;
  const options = found.map(({ i, n }, k) => {
    // A preview drawn beside the choices shares their lines; it starts after a wide gap with a box edge.
    const [, mark, , full] = OPTION.exec(lines[i]);
    const raw = full.replace(PREVIEW, "");
    if (mark) cursor = n;
    const box = BOX.exec(raw);
    const next = found[k + 1]?.i ?? Math.min(lines.length, i + 1 + MAX_GAP);
    const detail = [];
    for (const l of lines.slice(i + 1, next).map((x) => x.trim()).filter(Boolean)) {
      const s = SUBMIT.exec(l);
      if (s) {
        submit = { after: n };
        if (s[1]) cursor = "submit";
      } else if (!OPTION.test(l)) detail.push(l);
    }
    const option = { n, label: box ? raw.slice(box[0].length) : raw, detail: k + 1 < found.length ? detail.join(" ") : "" };
    if (box) option.checked = Boolean(box[1] && box[1] !== " ");
    return option;
  });
  // Without a cursor these are a numbered list, or a menu whose cursor is on a row that isn't read.
  if (cursor === null) return { ...none, unparsed: true };
  const multi = options.some((o) => "checked" in o);
  const preview = previewBeside(screen);
  return {
    question: questionAbove(lines, found[0].i), options, multi, submit, cursor, preview,
    summary: summaryAbove(lines, found[0].i),
    dialog: dialogWords(screen, found[0].i, last),
    above: aboveEdge(screen, found[0].i),
  };
}

// The dialog from its top edge to its last choice, without what the cursor changes: a permission's command can
// sit far above the question. With no edge it takes the whole screen, so a change there refuses rather than passes.
function edgeAbove(raw, start) {
  let top = start;
  while (top > 0 && !EDGE.test(raw[top - 1])) top--;
  return top;
}

// A rule drawn inside a dialog looks like its edge, so what's above it counts too.
function aboveEdge(screen, first) {
  const raw = (screen ?? "").split("\n"), top = edgeAbove(raw, first + Math.max(0, raw.length - 60));
  return raw.slice(0, Math.max(0, top - 1)).filter((l) => !STATUS.test(l)).map((l) => l.trim()).join("\n");
}

// A cursor with a sibling row lined up under it. A cursor alone is an old message or an input prompt.
function unnumberedMenu(screen) {
  const rows = (screen ?? "").split("\n").map((l) => l.replace(/^\s*[│┃]/, "")).filter((l) => l.trim()).slice(-TAIL);
  return rows.some((l, i) => {
    const m = /^(\s*)[❯›>]\s+\S/.exec(l);
    return Boolean(m && rows[i + 1]?.startsWith(`${m[1]}  `));
  });
}

function dialogWords(screen, first, last) {
  const raw = (screen ?? "").split("\n"), at = Math.max(0, raw.length - 60), start = first + at;
  const top = edgeAbove(raw, start);
  const framed = /^\s*[│┃]/.test(raw[start]);
  const row = (l) => (framed ? l.replace(/^\s*[│┃]/, "") : l).replace(PREVIEW, "");
  const clean = (l) => l.replace(FRAME, "").replace(/^[❯›>]\s*/, "").replace(/^(\d\.\s+)\[[^\]]?\]\s*/, "$1");
  return [...raw.slice(top, start), ...raw.slice(start, last + at + 1).map(row)].map(clean).filter(Boolean).join("\n");
}

// Still the dialog the card came from, wherever the cursor is and whatever the boxes say.
export const samePrompt = (seen, now) => Boolean(seen.dialog) && seen.dialog === now.dialog
  && (seen.above ?? "") === (now.above ?? "")
  && Boolean(seen.submit) === Boolean(now.submit)
  && seen.options.length === now.options.length
  && seen.options.every((o, i) => o.label === now.options[i].label);

// The same choices, apart from the one whose label an answer just replaced.
export const sameChoicesBut = (n, seen, now) => seen.options.length === now.options.length
  && seen.options.every((o, i) => o.n === n || o.label === now.options[i].label);

// The keys that move the cursor onto Submit and press it.
export function submitKeys(prompt) {
  if (!prompt?.submit) return null;
  const after = prompt.submit.after, at = prompt.cursor ?? 1;
  const moves = at === "submit" ? [] : at <= after ? Array(after - at + 1).fill("down") : Array(at - after).fill("up");
  return [...moves, "enter"];
}

// The question's own lines: not the tab strip of a multi-question form ("← ☒ CI gates ✔ Submit →").
const lastLines = (lines, n) => lines.filter((l) => l.trim() && !/^←.*→$/.test(l.trim())).slice(-n).join("\n");

// The paragraph right above the choices, at most 2 lines: it ends at a blank, the input prompt or a tab strip.
function questionAbove(lines, first) {
  const out = [];
  let i = first - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  for (; i >= 0 && out.length < 2; i--) {
    const l = lines[i].trim();
    if (!l || /^[❯›>]\s/.test(l) || /^←.*→$/.test(l) || /^[☐☒]\s/.test(l)) break;
    out.unshift(l);
  }
  return out.join("\n");
}

// The preview box drawn beside the choices shows the choice under the cursor; its inner text, or "".
function previewBeside(screen) {
  const raw = (screen ?? "").split("\n").slice(-40);
  const top = raw.findIndex((l) => /\d\.\s.*\s{3,}┌─+┐\s*$/.test(l));
  if (top < 0) return "";
  const out = [];
  for (const l of raw.slice(top + 1)) {
    if (/└─+┘\s*$/.test(l)) break;
    const m = /│(.*)│\s*$/.exec(l);
    if (m) out.push(m[1].trim());
  }
  while (out.length && !out.at(-1)) out.pop();
  return out.join("\n");
}

// A multi-question form's last step lists each question with its answer ("● question" then "→ answer")
// under "Review your answers"; the card shows it before Submit answers.
function summaryAbove(lines, first) {
  let start = -1;
  for (let i = first - 1; i >= 0 && start < 0; i--) if (/^review your answers$/i.test(lines[i].trim())) start = i;
  if (start < 0) return [];
  const out = [];
  for (const raw of lines.slice(start + 1, first)) {
    const l = raw.trim();
    if (/^●\s*/.test(l)) out.push({ question: l.replace(/^●\s*/, ""), answer: "" });
    else if (/^→\s*/.test(l) && out.length) out.at(-1).answer = l.replace(/^→\s*/, "");
  }
  return out;
}

// The free-text choice keeps the number it had as "Type something" once its label becomes what was typed.
// Claude puts it last before Submit in a multiple choice, and just before "Chat about this" in a single one.
export function freeOption(prompt, before = null) {
  const named = prompt.options.find((o) => /^type something/i.test(o.label))?.n;
  if (named) return named;
  if (before) return before;
  if (prompt.submit) return prompt.submit.after;
  const last = prompt.options.at(-1);
  return last && /^chat about this/i.test(last.label) && last.n > 1 ? last.n - 1 : null;
}

// The arrow presses from the cursor to choice `n`; Submit sits in the list right after `submit.after`.
export function moveKeys(prompt, n) {
  const order = prompt.options.flatMap((o) => (prompt.submit?.after === o.n ? [o.n, "submit"] : [o.n]));
  const from = order.indexOf(prompt.cursor ?? 1), to = order.indexOf(n);
  if (from < 0 || to < 0) return [];
  return Array(Math.abs(to - from)).fill(to > from ? "down" : "up");
}

// The agent's last words on screen: its last "⏺"/"•" line that isn't a tool call ("⏺ Bash(…)") or hook noise.
export function lastMessage(screen) {
  const lines = (screen ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*[⏺•]\s+(.+?)\s*$/.exec(lines[i]);
    if (!m) continue;
    const text = m[1];
    if (/^[A-Z][A-Za-z]*\(/.test(text) || /hook was skipped|^User (answered|declined)/.test(text)) continue;
    return text;
  }
  return "";
}
