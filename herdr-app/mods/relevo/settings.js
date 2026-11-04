import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
import { theme, exec, run, appHome, props, openOverlay, closeOverlay } from "herdr";
import * as CONFIG from "./config.js";
import { configuredLaunchers } from "./lib/launchers.js";
import { WRITE_SCRIPT, renderConfig, validate, slug, loginArgv } from "./lib/settings.js";
import { agentIcon, button, spinner } from "./ui.js";

/** @typedef {Record<string, any>} Row */
/** @typedef {Record<string, `#${string}`>} Colors */
/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {import("gpui-kit").Element} Element */
/** @param {InputState} state */
const text = (state) => state.value().trim();

/** @param {string} [tab] launchers, accounts or advanced */
export function openSettings(tab) {
  openOverlay({ mod: "relevo", kind: "dialog", width: 860, height: 640, props: { role: "settings", tab } });
}

export class Settings {
  /** @type {Row[]} */ launchers;
  /** @type {Row[]} */ accounts;
  /** @type {Row} */ codex;
  /** @param {Record<string, any> | undefined} props @param {Context} _cx */
  init(props, _cx) {
    this.seq = 0;
    this.tab = ["launchers", "accounts", "advanced"].includes(props?.tab) ? props.tab : "launchers";
    this.sel = /** @type {Row | null} */ (null);
    this.open = /** @type {Set<number>} */ (new Set());
    this.states = /** @type {Set<InputState>} */ (new Set());
    this.errors = /** @type {Array<{at:string,message:string}>} */ ([]);
    this.launchers = configuredLaunchers(CONFIG).map((l) => this.launcherRow(l));
    this.accounts = CONFIG.ACCOUNTS.map((a) => this.accountRow(a));
    this.codex = this.accountRow(CONFIG.CODEX);
    for (const l of this.launchers) l.account = [...this.accounts, this.codex].find((a) => this.keyOf(a) === l.orig?.account) ?? null;
    this.reposRoot = this.input(CONFIG.REPOS_ROOT, "code");
    this.skills = /** @type {Record<string, InputState>} */ (Object.fromEntries(Object.entries(CONFIG.SKILLS).map(([k, v]) => [k, this.input(v, k)])));
  }

  /** @param {string | undefined} value @param {string} placeholder */
  input(value, placeholder) {
    const state = InputState.new({ value: value ?? "", placeholder });
    state.on("change", (_e, cx) => { if (this.tried) this.errors = validate(this.collect()); cx.notify(); });
    state.on("submit", (_e, cx) => this.save(cx));
    this.states.add(state);
    return state;
  }

  /** @param {Row | null} [orig] @returns {Row} */
  launcherRow(orig = null) {
    const inputs = Object.fromEntries(["label", "profile", "command", "claudeDir"].map((k) => [k, this.input(orig?.[k], k)]));
    return { id: ++this.seq, orig, inputs, app: orig?.app ?? "claude", account: null, isDefault: Boolean(orig?.default) };
  }

  /** @param {Row | null} [orig] @returns {Row} */
  accountRow(orig = null) {
    // Colors are no longer edited here, but the agents list badge still needs valid ones.
    const fallback = /** @type {Record<string, string>} */ ({ bg: "#c3e88d", fg: "#1e2030" });
    const inputs = Object.fromEntries(["label", "claudeDir", "bg", "fg"].map((k) => [k, this.input(orig?.[k] ?? fallback[k], k)]));
    return { id: ++this.seq, orig, inputs };
  }

  /** @param {Row} row */
  keyOf(row) { return row.orig?.key ?? row.removedKey ?? slug(text(row.inputs.label)); }

  /** @returns {Record<string, any>} */
  collect() {
    /** @param {Row} row */
    const account = (row) => {
      const value = { ...row.orig, key: this.keyOf(row),
        ...Object.fromEntries(Object.entries(/** @type {Record<string, InputState>} */ (row.inputs)).map(([k, s]) => [k, text(s)])) };
      delete value.defaultLauncher;
      delete value.letter;
      return value;
    };
    const codex = account(this.codex);
    delete codex.claudeDir;
    // Older configs still export CONTEXTS and FALLBACK; nothing reads them, so saving drops them.
    const { CONTEXTS: _contexts, FALLBACK: _fallback, ...kept } = /** @type {Record<string, any>} */ (CONFIG);
    return {
      ...kept,
      ACCOUNTS: this.accounts.map(account), CODEX: codex,
      LAUNCHERS: this.launchers.map((l) => {
        const value = { ...l.orig, key: this.keyOf(l), app: l.app,
          ...Object.fromEntries(Object.entries(/** @type {Record<string, InputState>} */ (l.inputs)).map(([k, s]) => [k, text(s)])) };
        if (l.app !== "claude") delete value.claudeDir;
        if (l.app === "pi" || !l.account) delete value.account;
        else value.account = this.keyOf(l.account);
        if (l.isDefault && value.account) value.default = true;
        else delete value.default;
        return value;
      }),
      REPOS_ROOT: text(this.reposRoot),
      SKILLS: Object.fromEntries(Object.entries(this.skills).map(([k, s]) => [k, text(s)])),
    };
  }

  /** @param {Row} row */
  drop(row) { row.removedKey = this.keyOf(row); for (const s of Object.values(/** @type {Record<string, InputState>} */ (row.inputs))) { s.release(); this.states.delete(s); } }
  /** @param {AsyncContext} cx */
  changed(cx) { if (this.tried) this.errors = validate(this.collect()); cx.notify(); }
  /** @param {AsyncContext} cx */
  addAccount(cx) { const row = this.accountRow(); this.accounts.push(row); this.select("accounts", row); this.changed(cx); }
  /** @param {Row} row @param {AsyncContext} cx */
  removeAccount(row, cx) {
    this.accounts = this.accounts.filter((a) => a !== row);
    this.drop(row); this.changed(cx);
  }
  /** @param {AsyncContext} cx */
  addLauncher(cx) { const row = this.launcherRow(); this.launchers.push(row); this.select("launchers", row); this.changed(cx); }
  /** @param {Row} row @param {AsyncContext} cx */
  removeLauncher(row, cx) { this.launchers = this.launchers.filter((l) => l !== row); this.drop(row); this.changed(cx); }
  // The default launcher of an account is the one it opens on its own (PR actions, a handoff with no session); one per account.
  /** @param {Row} row @param {boolean} on @param {AsyncContext} cx */
  setDefault(row, on, cx) {
    if (on) for (const l of this.launchers) if (l.account === row.account) l.isDefault = false;
    row.isDefault = on;
    this.changed(cx);
  }
  // The order is the Agents + menu's.
  /** @param {Row} row @param {-1 | 1} by @param {AsyncContext} cx */
  moveLauncher(row, by, cx) {
    const i = this.launchers.indexOf(row), j = i + by;
    if (i < 0 || j < 0 || j >= this.launchers.length) return;
    [this.launchers[i], this.launchers[j]] = [this.launchers[j], this.launchers[i]];
    this.changed(cx);
  }

  /** @param {AsyncContext} cx */
  save(cx) {
    if (this.saving) return;
    this.tried = true;
    const config = this.collect();
    this.errors = validate(config);
    if (this.errors.length) { this.reveal(this.errors[0]); return cx.notify(); }
    this.saving = true; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", WRITE_SCRIPT, "sh", `${appHome()}/mods/relevo/config.js`, renderConfig(config)]);
        if (r.code !== 0) throw new Error(r.stderr.trim() || "Could not write config.js");
        closeOverlay(props()?.overlay);
      } catch (e) {
        this.saving = false;
        this.errors = [{ at: "write", message: e instanceof Error ? e.message : String(e) }]; cx.notify();
      }
    });
  }

  close() { for (const s of this.states) s.release(); this.states.clear(); }

  /** @param {string} tab @param {Row} row */
  select(tab, row) { this.tab = tab; this.sel = row; }

  // Jump to whatever a validation error is about, so Save never fails somewhere out of sight.
  /** @param {{at:string}} e */
  reveal(e) {
    const [head, i] = e.at.split(".");
    const rows = /** @type {Record<string, Row[]>} */ ({ accounts: this.accounts, launchers: this.launchers });
    if (head === "codex") this.select("accounts", this.codex);
    else if (rows[head]?.[Number(i)]) this.select(head, rows[head][Number(i)]);
    else if (["reposRoot", "skills"].includes(head)) this.tab = "advanced";
  }

  /** @returns {Row | null} */
  current() {
    const rows = this.tab === "accounts" ? [...this.accounts, this.codex] : /** @type {Row[]} */ (/** @type {any} */ (this)[this.tab] ?? []);
    return this.sel && rows.includes(this.sel) ? this.sel : rows[0] ?? null;
  }

  /** @param {string} tab @param {Row} row */
  issues(tab, row) {
    const prefix = row === this.codex ? "codex." : `${tab}.${/** @type {any} */ (this)[tab].indexOf(row)}.`;
    return this.errors.filter((e) => e.at.startsWith(prefix));
  }

  /** @param {Colors} t @param {string} id @param {string} label @param {InputState} state @param {string} [hint] */
  field(t, id, label, state, hint) {
    return v_flex().flex_1().min_w(0).gap(4)
      .child(div().text_size(11).text_color(t.muted).child(label))
      .child(Input.new(state).id(id).h(29).px(8).w_full().rounded(5).border(1).border_color(t.border).bg(t.background))
      .when(Boolean(hint), (el) => el.child(div().text_size(10.5).text_color(t.dim).child(hint)));
  }

  /** @param {Colors} t @param {string} id @param {Array<{value:any,label:string}>} options @param {any} current @param {(value:any,cx:Context)=>void} pick */
  choices(t, id, options, current, pick) {
    return h_flex().flex_wrap().gap(4).children(options.map((o, i) => div().id(`${id}-${i}`).px(10).py(5).rounded(5)
      .text_size(11.5).text_color(o.value === current ? t.foreground : t.muted)
      .bg(o.value === current ? t.selected : t.raised).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { pick(o.value, cx); this.changed(cx); }).child(o.label)));
  }

  /** @param {Colors} t @param {string} label @param {Element[]} children */
  group(t, label, children) {
    return v_flex().gap(8).child(div().text_size(10.5).font_semibold().text_color(t.dim).child(label.toUpperCase())).children(children);
  }

  /** @param {Colors} t @param {string} title @param {string} sub @param {((cx:Context) => void) | null} remove @param {Element[]} [extra] */
  head(t, title, sub, remove, extra = []) {
    return h_flex().items_center().justify_between().gap(10)
      .child(v_flex().min_w(0).gap(2).child(div().font_semibold().text_size(15).truncate().child(title))
        .child(div().text_size(11).text_color(t.dim).child(sub)))
      .child(h_flex().gap(6).flex_none().children(extra)
        .when(Boolean(remove), (el) => el.child(button(t, "settings-remove", "Remove", (/** @type {Context} */ cx) => remove?.(cx), { kind: "danger", size: "md" }))));
  }

  /** @param {Colors} t @param {Array<{message:string}>} errs */
  problems(t, errs) {
    return v_flex().gap(2).p(10).rounded(6).bg(t.blocked + "1a")
      .children(errs.map((e, i) => div().id(`settings-error-${i}`).text_size(11.5).text_color(t.blocked).child(e.message)));
  }

  /** @param {Colors} t @param {Row} l */
  launcherView(t, l) {
    const available = l.app === "codex" ? [this.codex] : this.accounts;
    const errs = this.issues("launchers", l);
    const adv = this.open.has(l.id) || errs.some((e) => /\.(command|claudeDir)$/.test(e.at));
    return v_flex().gap(18)
      .child(this.head(t, text(l.inputs.label) || "New launcher", `${this.keyOf(l) || "unsaved"} · starts ${l.app === "claude" ? "Claude Code" : l.app === "pi" ? "Pi" : "Codex CLI"} in a new tab`, (cx) => this.removeLauncher(l, cx), [
        button(t, "launcher-up", "↑", (/** @type {Context} */ cx) => this.moveLauncher(l, -1, cx), { tip: "Move up", disabled: this.launchers.indexOf(l) <= 0 }),
        button(t, "launcher-down", "↓", (/** @type {Context} */ cx) => this.moveLauncher(l, 1, cx), { tip: "Move down", disabled: this.launchers.indexOf(l) >= this.launchers.length - 1 }),
      ]))
      .when(errs.length > 0, (el) => el.child(this.problems(t, errs)))
      .child(this.group(t, "Launcher", [
        h_flex().gap(10).child(this.field(t, `launcher-label-${l.id}`, "Name", l.inputs.label))
          .child(this.field(t, `launcher-profile-${l.id}`, "Profile", l.inputs.profile)),
        this.choices(t, `launcher-app-${l.id}`, ["claude", "pi", "codex"].map((app) => ({ value: app, label: app === "claude" ? "Claude Code" : app === "pi" ? "Pi" : "Codex CLI" })), l.app,
          (app) => { l.app = app; l.account = null; }),
        ...(l.app === "codex" ? [div().text_size(11).text_color(t.dim).child("Codex launchers are not offered in the Agents + menu.")] : []),
      ]))
      .child(this.group(t, "Account", l.app === "pi"
        ? [div().text_size(11.5).text_color(t.muted).child("Pi picks its provider with the model selected inside it, so no account is attached.")]
        : [this.choices(t, `launcher-account-${l.id}`, [{ value: null, label: "Unassigned" }, ...available.map((a) => ({ value: a, label: text(a.inputs.label) || "New account" }))], l.account,
          (a) => { l.account = a; l.isDefault = false; }),
          ...(l.account ? [
            this.choices(t, `launcher-default-${l.id}`, [{ value: true, label: `Default launcher for ${text(l.account.inputs.label) || "this account"}` }, { value: false, label: "Not the default" }], l.isDefault,
              (v, cx) => this.setDefault(l, v, cx)),
            div().text_size(11).text_color(t.dim).child("The default launcher is what an account opens on its own: pull request actions and a handoff with no session to resume. At 100% usage you are asked before another account is used. The list order is the + menu's."),
          ] : [])]))
      .child(this.group(t, "Command", [
        h_flex().child(button(t, `launcher-adv-${l.id}`, adv ? "Hide command and folders" : "Show command and folders",
          (/** @type {Context} */ cx) => { if (this.open.has(l.id)) this.open.delete(l.id); else this.open.add(l.id); cx.notify(); }, { size: "sm" })),
        ...(adv ? [
          this.field(t, `launcher-command-${l.id}`, "Command", l.inputs.command, "Trusted shell code run as-is. Never put passwords or tokens here."),
          ...(l.app === "claude" ? [this.field(t, `launcher-dir-${l.id}`, "Claude profile folder", l.inputs.claudeDir, "Relative to your home folder, like .claude-sipos.")] : []),
        ] : []),
      ]));
  }

  /** @param {Colors} t @param {Row} a @param {boolean} [codex] */
  accountView(t, a, codex = false) {
    const i = this.accounts.indexOf(a), errs = this.issues("accounts", a);
    const login = loginArgv(codex ? "codex" : "claude", text(a.inputs.claudeDir));
    return v_flex().gap(18)
      .child(this.head(t, text(a.inputs.label) || "New account", `${codex ? "Codex" : "Claude"} account · usage`, !codex && this.accounts.length > 1 ? (cx) => this.removeAccount(a, cx) : null))
      .when(errs.length > 0, (el) => el.child(this.problems(t, errs)))
      .child(this.group(t, "Identity", [
        this.field(t, `account-label-${i}`, "Name", a.inputs.label),
      ]))
      .when(!codex, (el) => el.child(this.group(t, "Usage", [
        this.field(t, `account-dir-${i}`, "Credentials folder", a.inputs.claudeDir, "Relative to your home folder. Relevo reads usage from here and stores no credentials."),
      ])))
      .child(this.group(t, "Log in", [
        h_flex().child(button(t, `account-login-${codex ? "codex" : i}`, "Log in", () => { if (login) run("tab.new", { argv: login }); },
          { disabled: !login, tip: "Opens a new tab to sign in" })),
        div().text_size(11).text_color(t.dim).child(codex ? "Runs codex login in a new tab." : "Opens Claude with this folder in a new tab; type /login there."),
      ]));
  }

  /** @param {Colors} t */
  generalView(t) {
    const errs = this.errors.filter((e) => /^(reposRoot|skills)/.test(e.at));
    return v_flex().gap(18)
      .child(this.head(t, "General", "Repositories folder and slash commands", null))
      .when(errs.length > 0, (el) => el.child(this.problems(t, errs)))
      .child(this.group(t, "Repositories", [
        this.field(t, "settings-repos-root", "Repositories folder", this.reposRoot, "Relative to your home folder, like code."),
      ]))
      .child(this.group(t, "Slash commands", Object.entries(this.skills).map(([k, state]) => this.field(t, `settings-skill-${k}`, k, state))))
      .child(div().text_size(11).text_color(t.dim).child("Saving rewrites Relevo's config.js only. Existing Claude and Pi profiles, credentials and hooks are not touched."));
  }

  /** @param {Colors} t @param {string} id @param {boolean} on @param {Element | null} lead @param {string} label @param {string} sub @param {boolean} bad @param {() => void} pick */
  railRow(t, id, on, lead, label, sub, bad, pick) {
    return h_flex().id(id).h(30).px(8).gap(8).items_center().rounded(6).cursor_pointer().text_size(12)
      .when(on, (el) => el.bg(t.selected).text_color(t.foreground)).when(!on, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover)))
      .on_click((_e, cx) => { pick(); cx.notify(); })
      .when(Boolean(lead), (el) => el.child(/** @type {Element} */ (lead)))
      .child(div().flex_1().min_w(0).truncate().child(label))
      .child(div().flex_none().max_w(70).truncate().text_size(10.5).text_color(t.dim).child(sub))
      .when(bad, (el) => el.child(div().size(6).flex_none().rounded(3).bg(t.blocked)));
  }

  /** @param {Colors} t @param {string} title @param {string} addId @param {(cx:Context)=>void} add @param {Element[]} rows */
  railSection(t, title, addId, add, rows) {
    return v_flex().gap(2)
      .child(h_flex().h(24).px(8).items_center().justify_between().text_size(10.5).font_semibold().text_color(t.dim)
        .child(title.toUpperCase()).child(button(t, addId, "+", add, { size: "sm", tip: `Add ${title.toLowerCase().replace(/s$/, "")}` })))
      .children(rows);
  }

  /** @param {Colors} t @param {Row | null} cur */
  rail(t, cur) {
    const app = /** @type {Record<string, string>} */ ({ claude: "Claude", pi: "Pi", codex: "Codex" });
    return v_flex().id("settings-rail").w(236).flex_none().overflow_y_scrollbar().p(10).gap(14).border_r(1).border_color(t.border)
      .child(this.railSection(t, "Launchers", "settings-add-launcher", (cx) => this.addLauncher(cx), this.launchers.map((l) =>
        this.railRow(t, `settings-launcher-${l.id}`, this.tab === "launchers" && cur === l, null, text(l.inputs.label) || "New launcher",
          text(l.inputs.profile) || app[l.app], this.issues("launchers", l).length > 0, () => this.select("launchers", l)))))
      .child(this.railSection(t, "Accounts", "settings-add-account", (cx) => this.addAccount(cx), [...this.accounts, this.codex].map((a) =>
        this.railRow(t, `settings-account-${a.id}`, this.tab === "accounts" && cur === a, agentIcon(a === this.codex ? "codex" : "claude", 18), text(a.inputs.label) || "New account",
          a === this.codex ? "Codex" : "Claude", this.issues("accounts", a).length > 0, () => this.select("accounts", a)))))
      .child(this.railRow(t, "settings-tab-advanced", this.tab === "advanced", null, "General", "",
        this.errors.some((e) => /^(reposRoot|skills)/.test(e.at)), () => { this.tab = "advanced"; }));
  }

  /** @param {Context} _cx */
  render(_cx) {
    const t = /** @type {Colors} */ (theme());
    const cur = this.current();
    const empty = (/** @type {string} */ what) => div().text_size(12).text_color(t.muted).child(`No ${what} yet. Add one with the + in the list.`);
    const editor = this.tab === "advanced" ? this.generalView(t)
      : !cur ? empty(this.tab)
      : this.tab === "launchers" ? this.launcherView(t, cur)
      : this.accountView(t, cur, cur === this.codex);
    const first = this.errors[0];
    return v_flex().id("settings").size_full().bg(t.popover ?? t.surface).text_color(t.foreground)
      .child(h_flex().h(44).px(16).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13).child("Piioni · Relevo settings")))
      .child(h_flex().flex_1().min_h(0)
        .child(this.rail(t, cur))
        .child(v_flex().id("settings-body").flex_1().min_w(0).overflow_y_scrollbar().p(20).child(editor)))
      .child(h_flex().h(48).px(16).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(first ? t.blocked : t.dim)
          .child(first ? `${this.errors.length} to fix before saving · ${first.message}` : "No credentials are stored here"))
        .when(Boolean(this.saving), (el) => el.child(spinner(t.dim)))
        .child(button(t, "settings-cancel", "Cancel", () => closeOverlay(props()?.overlay), { size: "lg" }))
        .child(button(t, "settings-save", "Save", (/** @type {Context} */ cx) => this.save(cx), { kind: "solid", size: "lg", disabled: Boolean(this.saving) })));
  }
}
