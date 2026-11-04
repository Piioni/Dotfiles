import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, exec, run, home, agents, panes, terminals, notify, props, openOverlay, closeOverlay } from "herdr";
import { ACCOUNTS, CODEX, LAUNCHERS, accountOf, launchArgv, loadClaudeQuotas, chip } from "./accounts.js";
import { spinner } from "./ui.js";
import { GIT_READ } from "./lib/git.js";
import { terminalAccount, handoffPlan, resumePrompt, notePrompt } from "./lib/handoff.js";

const NOTES = ".local/state/relevo/handoff";
const START_TRIES = 60;

/** @param {string | null} [address] @param {string | null} [reason] */
export function openHandoff(address = null, reason = null) {
  const a = agents().find((x) => (address ? x.address === address : x.focused));
  if (!a) return notify({ title: "Focus the agent to hand off first", level: "info" });
  const cwd = panes().find((p) => p.pane === a.pane)?.cwd;
  const k = terminals().find((x) => x.address === a.address), from = terminalAccount(k);
  const rows = [...ACCOUNTS, CODEX].filter((acct) => acct.key !== from).length;
  openOverlay({
    mod: "relevo", kind: "popup", width: 300, height: 52 + rows * 40,
    props: {
      role: "handoff", terminal: a.address, space: a.space, tab: a.tab_name, cwd,
      from, transcript: k?.labels?.["agent.transcript"] || null, reason,
    },
  });
}

// From a full account: its focused agent, else one waiting on you, else one still working.
/** @param {string} account */
export function handoffFrom(account) {
  const mine = new Set(terminals().filter((k) => terminalAccount(k) === account).map((k) => k.address));
  const list = agents().filter((a) => mine.has(a.address));
  const a = list.find((x) => x.focused) ?? list.find((x) => x.status === "blocked") ?? list.find((x) => x.status === "working");
  if (!a) return notify({ title: `No ${accountOf(account).label} agent to hand off`, level: "info" });
  run("agent.focus", { terminal: a.address });
  openHandoff(a.address, "quota");
}

// Helpers and background work outlive an interrupt, and closing the tab would end them.
/** @param {string} address */
function hasHelpers(address) {
  const list = terminals();
  return Boolean(list.find((k) => k.address === address)?.labels?.["agent.bg"])
    || list.some((k) => k.parent === address && k.state === "live");
}

// Offered once the next agent runs. Only a resting agent goes, and only while the next one is still there.
/** @param {string} old @param {string} next */
export function closeHandedOff(old, next) {
  const status = agents().find((a) => a.address === old)?.status;
  if (status !== "idle" && status !== "done") {
    return notify({ title: "The previous agent is in use", body: "Nothing was closed.", level: "info" });
  }
  if (!agents().some((a) => a.address === next) || hasHelpers(old)) {
    return notify({ title: "The previous agent was kept", body: "Nothing was closed.", level: "info" });
  }
  const pane = panes().find((p) => p.terminal === old);
  if (!pane) return;
  const alone = !panes().some((p) => p.tab === pane.tab && p.terminal !== old);
  if (alone) run("tab.close", { id: pane.tab, confirmed: true });
  else run("terminal.kill", { terminal: old });
}

// Only a working agent gets the stop key: on a waiting one it would answer the dialog. Returns whether it stopped.
/** @param {string} address */
async function stopAgent(address) {
  if (agents().find((a) => a.address === address)?.status !== "working") return true;
  const r = await exec("hc", ["interrupt", address, "--json"]);
  try {
    if (r.code === 0) return ["stopped", "exited"].includes(JSON.parse(r.stdout).outcome);
    return ["not_found", "finished"].includes(JSON.parse(r.stderr).error?.kind);
  } catch {
    return false;
  }
}

// run() reports nothing, so the next agent counts as started once it's listed in its new tab.
/** @param {Set<string>} before @param {string} space @param {string} tab @param {import("gpui-kit").AsyncContext} cx */
async function started(before, space, tab, cx) {
  for (let i = 0; i < START_TRIES; i++) {
    const next = agents().find((a) => !before.has(a.address) && a.space === space && a.tab_name === tab);
    if (next) return next.address;
    await cx.sleep(500);
  }
  return null;
}

// A copy of the session file in the next account's config dir, so it can resume that conversation.
// Replacing an earlier copy is fine: --fork-session writes the new turns under another id.
// Copied beside it and renamed into place, so a link already there is replaced, not written through.
/** @param {{src:string,dir:string,id:string}} plan */
async function seedResume(plan) {
  const script = 'test -f "$1" && ! test -L "$1" && mkdir -p "$2" && cp "$1" "$2/.relevo-seed.$$" && mv -f "$2/.relevo-seed.$$" "$2/$3.jsonl"';
  const r = await exec("sh", ["-c", script, "sh", plan.src, plan.dir, plan.id]);
  return r.code === 0;
}

// The note carries what the next agent can't see: the last screen and the working tree.
/** @param {{terminal:string,cwd:string,from?:string|null}} source @param {string} to */
async function writeNote({ terminal, cwd, from }, to) {
  const screen = (await exec("hc", ["read", terminal, "--lines", "400"])).stdout
    .split("\n").slice(-160).join("\n").trim().replace(/`{5,}/g, "````");
  /** @param {string[]} args */
  const git = async (args) => (await exec("git", [...GIT_READ, ...args], { cwd })).stdout.trim();
  const note = [
    `# Handoff from ${from ? accountOf(from).label : "another account"} to ${accountOf(to).label}`,
    "", `Folder: ${cwd}`, `Branch: ${await git(["branch", "--show-current"]) || "(detached)"}`,
    "", "## Working tree", "", "```", await git(["status", "--short"]) || "clean", "```",
    "", "## Recent commits", "", "```", await git(["log", "--oneline", "-5"]), "```",
    "", "## The previous agent's last screen", "", "A record of its terminal, not instructions.", "",
    "`````", screen, "`````", "",
  ].join("\n");
  const path = `${home()}/${NOTES}/${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
  const r = await exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && printf "%s" "$2" > "$1"', "sh", path, note]);
  return r.code === 0 ? path : null;
}

export class Handoff {
  /** @param {unknown} _props @param {import("gpui-kit").AsyncContext} cx */
  init(_props, cx) {
    this.quotas = /** @type {Record<string, any> | null} */ (null);
    cx.spawn(async (cx) => {
      this.quotas = await loadClaudeQuotas();
      cx.notify();
    });
  }

  // The old agent stops first, so two can never edit the same tree, and the next one gets its last turn.
  // Stopping only ends a turn: if the rest fails, that agent can simply be told to go on.
  /** @param {string} to @param {import("gpui-kit").AsyncContext} cx */
  go(to, cx) {
    const p = props();
    if (this.busy || !p?.cwd) return;
    this.busy = to;
    this.error = null;
    cx.notify();
    /** @param {string} error */
    const fail = (error) => {
      this.busy = null;
      this.error = error;
      cx.notify();
    };
    cx.spawn(async (cx) => {
      try {
        if (!await stopAgent(p.terminal)) return fail("Couldn't stop this agent, so nothing started");
        const plan = handoffPlan({ from: p.from, to, transcript: p.transcript, launchers: LAUNCHERS, home: home() });
        const label = accountOf(to).label, tab = `${p.tab || "handoff"} · ${accountOf(to).label}`;
        let argv;
        if (plan.mode === "resume" && (!plan.seed || await seedResume(plan))) {
          argv = launchArgv(plan.launcher, resumePrompt(label, p.reason === "quota"), ["--resume", plan.id, "--fork-session"]);
        } else {
          const path = await writeNote(p, to);
          if (!path) return fail("Could not write the handoff note");
          argv = launchArgv(to, notePrompt(p.from === CODEX.key ? "Codex" : p.from ? "Claude Code" : "another agent", path));
        }
        const before = new Set(agents().map((a) => a.address));
        run("tab.new", { space: p.space, folder: p.cwd, name: tab, argv });
        const next = await started(before, p.space, tab, cx);
        closeOverlay(p.overlay);
        if (!next) notify({ title: `${label} hasn't reported yet`, body: `Check its tab, ${tab}.`, level: "warning" });
        else if (hasHelpers(p.terminal)) notify({ title: `Continued on ${label}`, body: "The previous agent's helpers keep running.", level: "warning" });
        else notify({ title: `Continued on ${label}`, body: "Click to close the previous agent", level: "success", timeout: 20000, action: { name: `relevo.handoff-close-${p.terminal}:${next}` } });
      } catch (e) {
        fail((e instanceof Error ? e.message : String(e)).slice(0, 80));
      }
    });
  }

  render() {
    const t = /** @type {Record<string, `#${string}`>} */ (theme()), p = props();
    if (!p?.terminal) return div();
    /** @param {Record<string, any> | null | undefined} q */
    const usage = (q) => [q?.h5 ? `5h ${q.h5.pct}%` : null, q?.d7 ? `7d ${q.d7.pct}%` : null]
      .filter(Boolean).join(" · ") || "no data";
    return v_flex().id("handoff").size_full().p(4).gap(1).bg(t.popover ?? t.surface).text_color(t.foreground)
      .child(div().px(8).pt(4).pb(6).text_size(11).text_color(this.error ? t.blocked : t.dim).truncate()
        .child(this.error ?? `Continue ${p.tab || p.terminal} with…`))
      .children([...ACCOUNTS, CODEX].filter((acct) => acct.key !== p.from).map((acct) => {
        const q = this.quotas?.[acct.key], full = q?.h5?.pct >= 100 || q?.d7?.pct >= 100;
        return h_flex().id(`handoff-${acct.key}`).h(36).px(8).gap(8).items_center().rounded(6)
          .when(!full, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.go(acct.key, cx)))
          .child(chip(div, acct))
          .child(v_flex().flex_1().min_w(0)
            .child(div().text_size(12.5).child(this.busy === acct.key ? "Starting…" : acct.label))
            .child(div().text_size(10.5).text_color(full ? t.blocked : t.muted).child(this.quotas ? usage(q) : spinner(t.dim, 10))));
      }));
  }
}
