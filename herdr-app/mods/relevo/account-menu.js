import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, closeOverlay } from "herdr";
import { ACCOUNTS, CODEX, accountOf, chip, loadClaudeQuotas } from "./accounts.js";
import { SKILLS, launchSkill } from "./skills.js";
import { skillUses, openPrSession } from "./prsession.js";
import { rankSkills, localBranch } from "./lib/prmenu.js";
import { spinner } from "./ui.js";

// The ▾ beside a PR skill: one chip per account, the recommended and most used skills, and a new
// session on the PR in its own worktree. Skills run on Claude accounts; Codex only takes the session.
export class AccountMenu {
  init(_props, cx) {
    this.quotas = null;
    this.uses = null;
    this.account = props()?.current ?? ACCOUNTS[0]?.key;
    cx.spawn(async (cx) => {
      [this.quotas, this.uses] = await Promise.all([loadClaudeQuotas(), skillUses()]);
      cx.notify();
    });
  }

  session(cx) {
    const p = props();
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const error = await openPrSession(p.pr, p.folder, this.account);
      if (!error) return closeOverlay(p.overlay);
      this.busy = false;
      this.error = error;
      cx.notify();
    });
  }

  render() {
    const t = theme(), p = props();
    if (!p?.pr) return div();
    const acct = accountOf(this.account), claude = this.account !== CODEX.key;
    const q = this.quotas?.[this.account];
    const usage = [q?.h5 ? `5h ${q.h5.pct}%` : null, q?.d7 ? `7d ${q.d7.pct}%` : null].filter(Boolean).join(" · ");
    const pickChip = (a) => div().id(`menu-acct-${a.key}`).p(2).rounded(6).cursor_pointer()
      .when(a.key === this.account, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .tooltip(a.label)
      .on_click((_e, cx) => {
        this.account = a.key;
        cx.notify();
      })
      .child(chip(div, a));
    const row = (id, label, note, onClick, enabled = true) => h_flex().id(id).h(30).px(8).gap(8).items_center().rounded(6)
      .text_size(12.5).text_color(enabled ? t.foreground : t.dim)
      .when(enabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => onClick(cx)))
      .child(div().flex_1().min_w(0).truncate().child(label))
      .when(Boolean(note), (el) => el.child(div().flex_none().text_size(10.5).text_color(t.dim).child(note)));
    const skills = rankSkills(p.skill, SKILLS, this.uses ?? {});
    return v_flex().id("account-menu").w_full().p(4).gap(1).bg(t.popover ?? t.surface).text_color(t.foreground)
      .child(h_flex().px(8).pt(4).pb(4).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(`${p.pr.repo.split("/").pop()} #${p.pr.number} with`))
        .children([...ACCOUNTS, CODEX].map(pickChip)))
      .child(div().px(8).pb(4).text_size(10.5).text_color(t.muted)
        .child(this.quotas ? `${acct.label}${usage ? ` · ${usage}` : ""}` : spinner(t.dim, 10)))
      .child(div().h(1).mx(6).my(2).bg(t.border))
      .children(skills.map(({ verb, uses }) => row(`menu-skill-${verb}`, SKILLS[verb].name,
        verb === p.skill ? "recommended" : `used ${uses}×`,
        () => {
          closeOverlay(p.overlay);
          launchSkill(p.pr, verb, this.account, p.folder);
        }, claude)))
      .when(!claude, (el) => el.child(div().px(8).pb(2).text_size(10.5).text_color(t.dim).child("Skills run on Claude accounts")))
      .child(div().h(1).mx(6).my(2).bg(t.border))
      .child(row("menu-session", this.busy ? "Creating the worktree…" : `New session in a worktree of ${localBranch(p.pr)}`,
        null, (cx) => this.session(cx), !this.busy && !p.pr.untrusted))
      .when(Boolean(p.pr.untrusted), (el) => el.child(div().px(8).pb(4).text_size(10.5).text_color(t.dim).child("Someone else's fork: check it out yourself")))
      .when(Boolean(this.error), (el) => el.child(div().px(8).pb(4).text_size(11).text_color(t.blocked).child(this.error)));
  }
}
