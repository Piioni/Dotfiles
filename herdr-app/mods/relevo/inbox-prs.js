// The Inbox's pull requests: fetch, cards, skill buttons. Mixed into Inbox, so `this` is the Inbox.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { home, exec, run, notify, setShared, openOverlay, readTextFile } from "herdr";
import { accountOf, pickAccount, chip } from "./accounts.js";
import { reviewAlerts, prAlerts } from "./alerts.js";
import { REPOS_ROOT } from "./config.js";
import { LAUNCHED, SKILLS, launched, launchSkill } from "./skills.js";
import { button, sectionHeader, spinner, withKey } from "./ui.js";
import { openReview } from "./review.js";
import { checkoutOf } from "./worktrees.js";
import { ago } from "./lib/time.js";
import { PR_QUERY, seconds, recent, mapMine, mapRequested, prChanges } from "./lib/github.js";
import { keepListed } from "./lib/addressed.js";
import { localBranch, pullRef, pullRefspec } from "./lib/prmenu.js";

const ADDRESSED = ".local/state/relevo/addressed.json";

export class PrViews {
  loadAddressed(cx) {
    cx.spawn(async (cx) => {
      try {
        this.addressed = JSON.parse(await readTextFile(`${home()}/${ADDRESSED}`) ?? "{}") ?? {};
      } catch {
        this.addressed = {};
      }
      this.publish();
      cx.notify();
    });
  }

  // Marks or unmarks a PR as addressed and writes the marks file.
  setAddressed(pr, on, cx) {
    const next = { ...this.addressed };
    if (on) next[pr.url] = Math.ceil(Date.now() / 1000);
    else delete next[pr.url];
    this.saveAddressed(next);
    this.publish();
    cx.notify();
  }

  saveAddressed(marks) {
    this.addressed = marks;
    exec("sh", ["-c", 'mkdir -p "$(dirname "$1")" && printf "%s" "$2" > "$1"', "sh", `${home()}/${ADDRESSED}`, JSON.stringify(marks)]);
  }

  scanPRs(cx) {
    if (this.scanningPRs) return;
    this.scanningPRs = true;
    if (!this.prsAt) cx.notify();
    cx.spawn(async (cx) => {
      try {
        await this.loadPRs();
      } catch (e) {
        this.error = `PRs: ${e?.message ?? e}`;
      } finally {
        this.scanningPRs = false;
        cx.notify();
      }
    });
  }

  async loadPRs() {
    const r = await exec("gh", ["api", "graphql", "-f", `query=${PR_QUERY}`]);
    if (r.code !== 0) {
      this.error = (r.stderr?.trim() || "gh failed").split("\n")[0];
      return;
    }
    this.error = null;
    const data = JSON.parse(r.stdout).data;
    this.mine = mapMine(data);
    this.requested = mapRequested(data);
    this.prsAt = Date.now() / 1000;
    const changes = prChanges(this.prState, data);
    this.prState = changes.state;
    prAlerts(changes.events);
    for (const p of [...this.mine, ...this.requested]) {
      if (p.repo in this.clones) continue;
      const path = `${home()}/${REPOS_ROOT}/${p.repo.split("/")[1]}`;
      // Same folder name can belong to another owner's repo.
      const origin = await exec("git", ["-C", path, "remote", "get-url", "origin"]);
      const same = origin.code === 0 && origin.stdout.trim().replace(/\.git$/, "").toLowerCase()
        .endsWith(`github.com${origin.stdout.includes("@github.com:") ? ":" : "/"}${p.repo.toLowerCase()}`);
      this.clones[p.repo] = same ? path : null;
    }
    const live = new Set([...this.mine, ...this.requested].map((p) => p.url));
    const listed = keepListed(this.addressed, live);
    if (Object.keys(listed).length !== Object.keys(this.addressed).length) this.saveAddressed(listed);
    const kept = Object.entries(launched()).filter(([url]) => live.has(url));
    if (kept.length !== Object.keys(launched()).length) setShared(LAUNCHED, Object.fromEntries(kept));
    reviewAlerts(this.requested);
    this.publish();
  }

  // The left part runs the skill with the picked account; ▾ picks the account, other skills or a new session.
  skillButton(t, pr, skill, solid) {
    const folder = this.clones[pr.repo];
    const pick = pickAccount(this.quotas), acct = accountOf(pick.key);
    const tip = pick.note ?? `Runs with ${acct.label}`;
    const fg = solid ? t.solid_foreground : t.foreground;
    return h_flex().id(`skill-${skill}-${pr.url}`).h(24).flex_none().rounded(6).overflow_hidden()
      .when(solid, (el) => el.bg(t.solid))
      .when(!solid, (el) => el.border_1().border_color(t.border))
      .child(h_flex().id(`run-${skill}-${pr.url}`).h_full().pl(9).pr(7).gap(5).items_center().cursor_pointer()
        .text_size(11.5).text_color(fg)
        .tooltip(tip).hover((s) => s.bg(solid ? t.solid : t.hover))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          launchSkill(pr, skill, pickAccount(this.quotas, true).key, folder);
          this.publish();
          cx.notify();
        })
        .child(SKILLS[skill].name)
        .child(chip(div, acct, 15)))
      .child(div().id(`pick-${skill}-${pr.url}`).h_full().px(6).flex().items_center().cursor_pointer()
        .text_size(10).text_color(fg)
        .border_l(1).border_color(solid ? t.solid_foreground : t.border)
        .hover((s) => s.bg(solid ? t.solid : t.hover)).tooltip("Choose the account")
        .on_click((_e, cx) => {
          cx.stop_propagation();
          openOverlay({
            mod: "relevo", kind: "popup", width: 320, height: 150 + 30 * Object.keys(SKILLS).length,
            props: {
              role: "account-menu",
              pr: {
                url: pr.url, number: pr.number, repo: pr.repo, updatedAt: pr.updatedAt, title: pr.title,
                headRefName: pr.headRefName, baseRefName: pr.baseRefName,
                isCrossRepository: pr.isCrossRepository, untrusted: Boolean(pr.untrusted),
              },
              skill, folder, current: pick.key,
            },
          });
        })
        .child("▾"));
  }

  threadBadge(t, n, key) {
    return h_flex().id(`threads-${key}`).flex_none().gap(3).items_center().text_size(10.5).text_color(t.ansi3)
      .tooltip(`${n} unresolved ${n === 1 ? "thread" : "threads"}`)
      .child(svg("mods/relevo/thread.svg").size(11).text_color(t.ansi3))
      .child(String(n));
  }

  ciBadge(t, state, key) {
    const [glyph, color, tip] = state === "SUCCESS" ? ["✓", t.ansi2, "CI passed"]
      : state === "FAILURE" || state === "ERROR" ? ["✕", t.ansi1, "CI failed"] : ["◌", t.ansi3, "CI running"];
    return div().id(`ci-${key}`).flex_none().text_size(11.5).font_semibold().text_color(color).tooltip(tip)
      .child(glyph === "◌" ? spinner(color, 11) : glyph);
  }

  agentLine(pr, agent) {
    const l = launched()[pr.url], name = SKILLS[l.skill].name;
    if (!agent) return `${name} ran ${ago(l.at)}`;
    if (agent.status === "working") return `${name} working…`;
    if (agent.status === "blocked") return `${name} is waiting for you`;
    return l.skill === "review" ? "draft review ready on GitHub" : `${name} finished`;
  }

  prCard(t, pr, requested, addressed = false) {
    const l = launched()[pr.url], agent = this.prAgents[pr.url], seen = this.seen(pr);
    const meta = requested ? `review requested · ${pr.author?.login ?? ""}` : pr.reasons.join(" · ");
    const done = Boolean(l && seen) && (!agent || agent.status === "idle" || agent.status === "done");
    const actions = [];
    if (agent) actions.push(button(t, `agent-${pr.url}`, "Agent", () => run("agent.focus", { terminal: agent.address })));
    if (this.clones[pr.repo] && !(seen && agent)) {
      pr.skills.forEach((s) => actions.push(this.skillButton(t, pr, s, !seen && !requested && pr.hot && s === "fix")));
    }
    if (!requested && this.clones[pr.repo]) {
      actions.push(button(t, `review-pr-${pr.url}`, "Review", () => this.reviewPR(pr), {
        tip: withKey("The whole PR against its base, line by line", "relevo.review"),
      }));
    }
    actions.push(button(t, `open-${pr.url}`, "Open PR", () => exec("open", [pr.url]), {
      kind: done && l.skill === "review" ? "solid" : "outline",
    }));
    actions.push(addressed
      ? button(t, `undo-${pr.url}`, "Undo", (cx) => this.setAddressed(pr, false, cx), { tip: "Back to the list" })
      : button(t, `addressed-${pr.url}`, "✓", (cx) => this.setAddressed(pr, true, cx), {
        tip: "Addressed: hide until there's new activity",
      }));
    const dot = seen ? "ring" : !requested && pr.hot ? t.blocked : t.accent;
    return this.card(t, `pr-${pr.url}`, !seen && !requested && pr.hot,
      this.head(t, dot, `${pr.repo.split("/")[1]} #${pr.number} · ${pr.title}`, ago(seconds(pr.updatedAt)),
        pr.commits?.nodes[0]?.commit?.statusCheckRollup?.state, pr.threads),
      v_flex().gap(2).text_size(11.5).text_color(t.muted)
        .when(Boolean(meta), (el) => el.child(meta))
        .when(Boolean(l && seen), (el) => el.child(
          div().text_color(agent?.status === "working" ? t.working : t.dim).child(this.agentLine(pr, agent)))),
      actions);
  }

  // The review pane on the PR's checkout, else on its exact head; comments go to its agent, or a new one when none runs.
  async reviewPR(pr) {
    const clone = this.clones[pr.repo];
    const info = { repo: pr.repo, number: pr.number, url: pr.url, base: pr.baseRefName, head: pr.headRefName };
    const folder = await checkoutOf(clone, localBranch(pr));
    if (!folder) {
      const r = await exec("git", ["-C", clone, "fetch", "--quiet", "origin", pullRefspec(pr)]);
      if (r.code !== 0) {
        return notify({ title: `Could not fetch PR #${pr.number}`, body: r.stderr.trim().split("\n")[0], level: "warning" });
      }
      info.ref = pullRef(pr);
    }
    openReview(folder ?? clone, this.prAgents[pr.url]?.address ?? null, info);
  }

  // Old PRs fold under one line so each group shows what needs you this month, addressed ones under another.
  prGroup(t, key, label, list, requested, done = []) {
    if (!list.length && !done.length) return [];
    const fresh = list.filter(recent), old = list.filter((p) => !recent(p)), open = this.expanded[key];
    const rows = [sectionHeader(t, label, fresh.length), ...fresh.map((p) => this.prCard(t, p, requested))];
    if (old.length) {
      rows.push(div().id(`older-${key}`).px(4).py(2).text_size(11).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.muted))
        .on_click((_e, cx) => {
          this.expanded[key] = !open;
          cx.notify();
        })
        .child(`${open ? "▾" : "▸"} ${old.length} older than 45 days`));
      if (open) rows.push(...old.map((p) => this.prCard(t, p, requested)));
    }
    rows.push(...this.addressedFold(t, key, done, (p) => this.prCard(t, p, requested, true)));
    return rows;
  }
}
