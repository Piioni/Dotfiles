import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, run, focused, panes, shared, setShared, openOverlay } from "herdr";
import { BackgroundWatch, quotaAlerts } from "./alerts.js";
import { ACCOUNTS, CODEX, LAUNCHERS, API_QUOTAS, API_QUOTAS_AT, launchArgv, launcherOf, loginLauncher, launchChoice, chip, loadClaudeQuotas, publishSetup } from "./accounts.js";
import { ago, resetText, resetClock, runsOut, clock, FIVE_HOURS, WEEK } from "./lib/time.js";

/** @typedef {Record<string, `#${string}`>} ThemeColors */
/** @typedef {Record<string, any>} Data */
/** @typedef {import("gpui-kit").AsyncContext} AsyncContext */
/** @typedef {import("gpui-kit").Context} Context */
const LENGTH = { "5h": FIVE_HOURS, "7d": WEEK };
// The reset, and when the window runs out first at the pace used so far.
/** @param {Data | null | undefined} w @param {"5h" | "7d"} label */
const meterTip = (w, label) => {
  const out = runsOut(w, LENGTH[label]);
  return out ? `${resetText(w)} · at this pace 100% at ${clock(out)}` : resetText(w);
};
import { collectQuotas, LOGIN_EXPIRED } from "./quota.js";
import { ledgerTick } from "./ledger.js";
import { spinner, withKey } from "./ui.js";
import { openSettings } from "./settings.js";

const STALE = 30 * 60;
const QUOTA_EVERY = 5 * 60 * 1000;

export class Sidebar {
  /** @param {unknown} _props @param {Context} cx */
  init(_props, cx) {
    this.quota = /** @type {Record<string, any>} */ ({});
    this.refreshing = false;
    publishSetup(ACCOUNTS, LAUNCHERS);
    this.width = 268;
    // The snapshots on disk answer at once; the usage endpoints follow.
    this.load(cx);
    // Every saved file reloads the mod, and a burst of reloads makes the endpoints answer 429.
    if (Date.now() - Number(shared(API_QUOTAS_AT) ?? 0) >= QUOTA_EVERY) this.collect(cx);
    cx.timer.every(30000, (cx) => this.load(cx));
    cx.timer.every(QUOTA_EVERY, (cx) => this.collect(cx));
    this.watch = new BackgroundWatch();
    cx.timer.every(3000, (cx) => {
      this.watch.tick();
      cx.spawn(async () => {
        await ledgerTick();
      });
    });
  }

  // The usage endpoints; the statusline also writes a snapshot while a session runs.
  /** @param {AsyncContext} cx */
  collect(cx) {
    setShared(API_QUOTAS_AT, Date.now());
    cx.spawn(async (cx) => {
      try {
        setShared(API_QUOTAS, await collectQuotas());
        Object.assign(this.quota, await loadClaudeQuotas());
        quotaAlerts(this.quota);
      } finally {
        this.refreshing = false;
        cx.notify();
      }
    });
  }

  // A click asks the endpoints again now instead of waiting for the 5 minute timer.
  /** @param {AsyncContext} cx */
  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true;
    this.collect(cx);
    cx.notify();
  }

  /** @param {ThemeColors} t @param {Data} p @param {number} [size] */
  mark(t, p, size = 17) {
    return this.refreshing ? div().size(size).flex_none().flex().items_center().justify_center().child(spinner(t.dim, 12)) : chip(div, p, size);
  }

  /** @param {AsyncContext} cx */
  load(cx) {
    cx.spawn(async (cx) => {
      Object.assign(this.quota, await loadClaudeQuotas());
      this.loaded = true;
      cx.notify();
    });
  }

  /** @param {string | Record<string, any>} key */
  launch(key) {
    const f = focused();
    const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
    const folder = pane?.cwd ?? f?.cwd ?? undefined, requested = typeof key === "string" ? launcherOf(key) : key;
    const { launcher, note } = launchChoice(requested, this.quota);
    if (launcher === requested) return run("tab.new", { folder, argv: launchArgv(requested) });
    // A full account: ask, never switch on its own.
    openOverlay({ mod: "relevo", kind: "dialog", width: 420, height: 150, props: { role: "fallback", note, folder, requested: requested.key, alternative: launcher.key } });
  }

  /** @param {ThemeColors} t @param {string} id @param {"5h" | "7d"} label @param {Data | null | undefined} w @param {number} barWidth @param {boolean} stale @param {boolean} hovered */
  meter(t, id, label, w, barWidth, stale, hovered) {
    const level = !w || stale ? t.dim : w.pct >= 80 ? t.blocked : w.pct >= 50 ? t.ansi3 : t.accent;
    return v_flex().id(id).w(barWidth).flex_none().gap(3).tooltip(meterTip(w, label))
      .child(h_flex().justify_between().text_size(10.5).text_color(t.muted)
        .child(hovered && resetClock(w) ? `↻ ${resetClock(w)}` : label)
        .when(!(hovered && resetClock(w)), (el) => el.child(w ? `${w.pct}%` : "—")))
      .child(div().relative().w(barWidth).h(4).rounded(2).bg(t.raised)
        .when(Boolean(w?.pct), (el) => el.child(
          div().absolute().left(0).top(0).h(4).rounded(2).bg(level)
            .w(Math.max(2, barWidth * Math.min(w.pct, 100) / 100)))));
  }

  /** @param {Data} p */
  expired(p) {
    return /** @type {Record<string, any>} */ (shared(API_QUOTAS) ?? {})[p.key]?.error === LOGIN_EXPIRED;
  }

  /** @param {ThemeColors} t @param {Data} p @param {Data | null} q @param {number} barWidth */
  row(t, p, q, barWidth) {
    const age = q ? Date.now() / 1000 - q.updated : Infinity, stale = age > STALE;
    const expired = this.expired(p);
    const note = expired
      ? `Login expired. Start ${loginLauncher(p).label} to renew it`
      : !q
      ? "No data yet"
      : stale ? `Last updated ${ago(q.updated)}; the usage endpoint did not answer since` : `Updated ${ago(q.updated)}`;
    const hovered = this.hovered === p.key;
    return h_flex().id(`account-${p.key}`).h(30).flex_none().px(8).gap(8).items_center().rounded(6)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.refresh(cx))
      .on_hover((on, cx) => {
        this.hovered = on ? p.key : this.hovered === p.key ? null : this.hovered;
        cx.notify();
      })
      .child(div().id(`account-name-${p.key}`).w(80).flex_none().flex().items_center().gap(8)
        .tooltip(`${note}. Click to refresh usage.`)
        .child(this.mark(t, p))
        .child(div().flex_1().min_w(0).truncate().text_size(12).font_medium().text_color(stale ? t.muted : t.foreground)
          .child(p.label)))
      .when(!this.loaded && !q && !expired, (el) => el.child(h_flex().flex_1().justify_center().child(spinner(t.dim, 10))))
      .when(expired && !q, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.blocked).child("login expired")))
      .when((this.loaded || Boolean(q)) && !(expired && !q), (el) => el
        .child(this.meter(t, `meter-5h-${p.key}`, "5h", q?.h5, barWidth, stale, hovered))
        .child(this.meter(t, `meter-7d-${p.key}`, "7d", q?.d7, barWidth, stale, hovered)));
  }

  // The folded sidebar: chips with one bar for the fuller window, details in the tooltip.
  /** @param {ThemeColors} t */
  rail(t) {
    /** @param {Data} p */
    const cell = (p) => {
      const q = this.quota[p.key], w = [q?.h5, q?.d7].filter(Boolean).sort((a, b) => b.pct - a.pct)[0];
      const stale = !q || Date.now() / 1000 - q.updated > STALE;
      const level = !w || stale ? t.dim : w.pct >= 80 ? t.blocked : w.pct >= 50 ? t.ansi3 : t.accent;
      const usage = [q?.h5 ? `5h ${q.h5.pct}%` : null, q?.d7 ? `7d ${q.d7.pct}%` : null]
        .filter(Boolean).join(" · ") || (this.expired(p) ? `login expired, start ${loginLauncher(p).label} to renew it` : "no data");
      return v_flex().id(`account-${p.key}`).w_full().py(3).gap(3).items_center().rounded(6)
        .cursor_pointer().hover((s) => s.bg(t.hover))
        .tooltip(`${p.label} · ${usage}. Click to refresh usage.`)
        .on_click((_e, cx) => this.refresh(cx))
        .child(this.mark(t, p, 20))
        .child(div().relative().w(20).h(3).rounded(2).bg(t.raised)
          .when(Boolean(w?.pct), (el) => el.child(
            div().absolute().left(0).top(0).h(3).rounded(2).bg(level)
              .w(Math.max(2, 20 * Math.min(w.pct, 100) / 100)))));
    };
    return v_flex().id("relevo-accounts").size_full().min_h(0).overflow_y_scrollbar().px(6).pt(4).gap(2).bg(t.chrome).text_color(t.foreground)
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) > 1) {
          this.width = size.width;
          cx.notify();
        }
      })
      .children([...ACCOUNTS, CODEX].map(cell));
  }

  render() {
    const t = /** @type {ThemeColors} */ (theme());
    if (this.width < 160) return this.rail(t);
    const barWidth = Math.max(40, Math.floor((this.width - 16 - 16 - 80 - 16) / 2));
    return v_flex().id("relevo-accounts").size_full().min_h(0).overflow_y_scrollbar().px(8).pt(4).pb(8).gap(1).bg(t.chrome).text_color(t.foreground)
      .on_size_change((size, cx) => {
        if (Math.abs(size.width - this.width) > 1) {
          this.width = size.width;
          cx.notify();
        }
      })
      .child(h_flex().h(22).flex_none().pl(8).items_center().justify_between().text_size(11).text_color(t.dim)
        .child(h_flex().gap(4).items_center()
          .child("ACCOUNTS")
          .child(div().id("relevo-settings").size(16).flex().items_center().justify_center().rounded(4).cursor_pointer()
            .text_color(t.dim).hover((s) => s.bg(t.hover).text_color(t.foreground))
            .tooltip(withKey("Settings", "relevo.settings"))
            .on_click((_e, cx) => {
              cx.stop_propagation();
              openSettings();
            })
            .child(svg("mods/relevo/settings.svg").size(11)))))
      .children([...ACCOUNTS, CODEX].map((p) => this.row(t, p, this.quota[p.key], barWidth)));
  }
}
