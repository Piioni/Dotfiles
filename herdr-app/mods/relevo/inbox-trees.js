// The Inbox's merged worktrees: scan, open, remove. Mixed into Inbox, so `this` is the Inbox.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { run } from "herdr";
import { scanWorktrees, removeWorktree, removalCheck } from "./worktrees.js";
import { button, spinner } from "./ui.js";
import { ago } from "./lib/time.js";

/** @param {string[]} files */
const deletes = (files) => `deletes ${files.slice(0, 2).join(", ")}${files.length > 2 ? ` +${files.length - 2}` : ""}`;

/** @typedef {{main:string, path:string, branch?:string, locked?:boolean, missing?:boolean, at?:number, repo?:string, name?:string, space?:string|null, open?:boolean, merged?:boolean, dirty?:boolean, ignored?:string[]}} Worktree */
/** @typedef {`#${string}`} Color */
/** @typedef {{notify:()=>void, sleep:(ms:number)=>Promise<void>, spawn:(body:(cx:TreeContext)=>unknown)=>unknown}} TreeContext */

export class TreeViews {
  /** @type {Worktree[]} */
  worktrees;
  /** @type {Set<string>} */
  removing;
  /** @type {Set<string>} */
  checking;
  /** @type {Set<string>} */
  gone;
  /** @type {Record<string,string>} */
  wtError;
  /** @type {string|null} */
  confirm;
  /** @type {{loose?:boolean}} */
  expanded;
  /** @type {Set<string>|undefined} */
  hiddenIds;
  /** @type {(id:string)=>boolean} */
  selected;

  /** @param {TreeContext} cx @param {boolean} [force=false] */
  scanTrees(cx, force = false) {
    if (this.scanningTrees) return;
    this.scanningTrees = true;
    this.treesAt = Date.now();
    cx.spawn(async (cx) => {
      try {
        this.worktrees = await scanWorktrees(force);
      } catch (e) {
        this.wtError.scan = e instanceof Error ? e.message : String(e);
      } finally {
        this.scanningTrees = false;
      }
      cx.notify();
    });
  }

  /** @param {Worktree} w */
  openTree(w) {
    if (w.space) run("space.select", { id: w.space });
    else run("space.new", { folder: w.path });
  }

  // Only clean, unlocked worktrees get here; one with a space closes it first, as Herdr's dialog does.

  // Only clean, unlocked worktrees get here; one with a space closes it first, as Herdr's dialog does.
  /** @param {Worktree} w @param {TreeContext} cx */
  removeTree(w, cx) {
    this.checking ??= new Set();
    if (this.checking.has(w.path)) return;
    this.checking.add(w.path);
    const asked = this.confirm === w.path, shown = JSON.stringify([w.ignored ?? [], w.space ?? null]);
    cx.spawn(async (cx) => {
      try {
        const check = await removalCheck(w);
        if (check.error) {
          this.confirm = null;
          this.wtError[w.path] = check.error;
          return cx.notify();
        }
        delete this.wtError[w.path];
        w.space = check.space;
        w.ignored = check.ignored;
        // What the confirmation names must be what goes.
        if (!asked || JSON.stringify([check.ignored, check.space]) !== shown) {
          this.confirm = w.path;
          return cx.notify();
        }
        this.confirm = null;
        await this.removeOne(w, cx);
      } finally {
        this.checking.delete(w.path);
      }
    });
  }

  /** @param {Worktree} w @param {TreeContext} cx */
  async removeOne(w, cx) {
    this.removing.add(w.path);
    delete this.wtError[w.path];
    cx.notify();
    if (w.space) run("space.close", { id: w.space, confirmed: true });
    const err = await removeWorktree(w);
    if (!err) {
      // The row folds away natively before it leaves the list.
      this.gone.add(w.path);
      cx.notify();
      await cx.sleep(240);
      this.gone.delete(w.path);
      this.worktrees = this.worktrees.filter((x) => x.path !== w.path);
    }
    this.removing.delete(w.path);
    if (err) this.wtError[w.path] = err;
    cx.notify();
  }

  // Merged, clean, unlocked and not open anywhere: safe to remove together. One with a space stays for its own
  // Remove, because closing several spaces at once is easy to regret.
  /** @param {Worktree[]} merged */
  removable(merged) {
    return merged.filter((w) => !w.dirty && !w.locked && !w.space && !w.open && !w.ignored?.length && !this.removing.has(w.path));
  }

  /** @param {Worktree[]} list @param {TreeContext} cx */
  removeAll(list, cx) {
    if (this.confirm !== "all") {
      this.confirm = "all";
      cx.notify();
      return;
    }
    this.confirm = null;
    cx.spawn(async (cx) => {
      for (const w of list) {
        const check = await removalCheck(w);
        if (check.error || check.space || check.ignored.length) {
          this.wtError[w.path] = check.error ?? (check.space ? "has a space" : deletes(check.ignored));
          w.ignored = check.ignored ?? w.ignored;
          cx.notify();
          continue;
        }
        await this.removeOne(w, cx);
      }
    });
  }

  // One line per merged worktree: Remove asks once more before git runs.

  // One line per merged worktree: Remove asks once more before git runs.
  /** @param {Record<string,Color>} t @param {Worktree} w */
  treeRow(t, w) {
    if (this.hiddenIds?.has(`wt-${w.path}`)) return null;
    if (this.removing.has(w.path)) return this.removingRow(t, w);
    const err = this.wtError[w.path], sure = this.confirm === w.path;
    const warn = sure ? [w.space && "closes its space", w.ignored?.length && deletes(w.ignored)].filter(Boolean).join(", ") : "";
    const note = err ?? (warn || (w.dirty ? "uncommitted changes" : w.locked ? "locked" : null));
    /** @param {string} id @param {string} label @param {string} tip @param {(cx:TreeContext)=>void} onClick @param {boolean} [danger=false] */
    const action = (id, label, tip, onClick, danger = false) =>
      button(t, id, label, onClick, { size: "sm", tip, kind: danger ? "danger" : "outline" });
    return h_flex().id(`wt-${w.path}`).h(30).px(8).gap(6).items_center().rounded(6)
      .when(this.selected(`wt-${w.path}`), (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover)).tooltip(note ? `${note}\n${w.path}` : w.path)
      .child(div().flex_none().text_size(11.5).text_color(t.muted).child(w.repo))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).child(w.branch ?? w.name))
      .when(Boolean(note), (el) => el.child(
        div().flex_none().max_w(140).truncate().text_size(10.5).text_color(err || sure ? t.blocked : t.dim).child(note)))
      .when(Boolean(w.at), (el) => el.child(this.age(t, w)))
      .child(action(`wt-open-${w.path}`, w.space ? "Go" : "Open", w.space ? "Go to its space" : "Open a space here",
        () => this.openTree(w)))
      .when(!w.dirty && !w.locked, (el) => el.child(action(`wt-rm-${w.path}`, sure ? "Confirm" : "Remove",
        "Removes the worktree and its local branch. Files git ignores go with it",
        (cx) => this.removeTree(w, cx), sure)));
  }

  // git can take a few seconds on a big checkout; the spinner runs natively, without redraws.

  // git can take a few seconds on a big checkout; the spinner runs natively, without redraws.
  /** @param {Record<string,Color>} t @param {Worktree} w */
  removingRow(t, w) {
    const gone = this.gone.has(w.path);
    return h_flex().id(`wt-${w.path}`).h(gone ? 0 : 30).px(8).gap(6).items_center().rounded(6).overflow_hidden()
      .opacity(gone ? 0 : 0.6)
      .transition("opacity", { duration: 200 }).transition("height", { duration: 220, easing: "ease-out" })
      .child(div().flex_none().text_size(11.5).text_color(t.muted).child(w.repo))
      .child(div().flex_1().min_w(0).truncate().text_size(11.5).child(w.branch ?? w.name))
      .child(h_flex().flex_none().gap(5).items_center().text_size(10.5).text_color(t.blocked)
        .child(spinner(t.blocked))
        .child("Removing…"));
  }

  /** @param {Record<string,Color>} t @param {Worktree} w */
  age(t, w) {
    return div().flex_none().text_size(10.5).text_color(t.dim).child(ago(w.at).replace(" ago", ""));
  }

  // Agent time per ticket today, for the weekly time tracker.

  /** @param {Record<string,Color>} t @param {Worktree[]} worktrees */
  treeGroups(t, worktrees) {
    const merged = worktrees.filter((w) => w.merged);
    const loose = worktrees.filter((w) => !w.merged && !w.open);
    const clean = this.removable(merged), sure = this.confirm === "all";
    const header = h_flex().pt(6).px(2).gap(6).items_center().text_size(10.5).text_color(t.dim)
      .child(div().flex_1().child("MERGED WORKTREES"))
      .child(String(merged.length))
      .when(clean.length > 1, (el) => el.child(button(t, "wt-rm-all", sure ? `Confirm ${clean.length}` : `Remove ${clean.length}`,
        (/** @type {TreeContext} */ cx) => this.removeAll(clean, cx), {
          size: "sm", kind: sure ? "danger" : "outline",
          tip: "Removes every merged worktree that is clean, unlocked, has no space and no ignored files to keep, with its local branch",
        })));
    const rows = merged.length
      ? [header, v_flex().children(merged.map((w) => this.treeRow(t, w)).filter(Boolean))]
      : [];
    if (loose.length) {
      const open = this.expanded.loose;
      rows.push(div().id("older-loose").px(4).pt(6).text_size(11).text_color(t.dim).cursor_pointer()
        .hover((s) => s.text_color(t.muted))
        .on_click((_e, cx) => {
          this.expanded.loose = !open;
          cx.notify();
        })
        .child(`${open ? "▾" : "▸"} ${loose.length} worktrees without a space`));
      const shown = loose.filter((w) => !this.hiddenIds?.has(`loose-${w.path}`));
      if (open) rows.push(...shown.map((w) => h_flex().id(`loose-${w.path}`).h(26).px(8).gap(8).items_center().rounded(6)
        .when(this.selected(`loose-${w.path}`), (el) => el.bg(t.selected))
        .cursor_pointer().hover((s) => s.bg(t.hover)).tooltip(w.path)
        .on_click(() => this.openTree(w))
        .child(div().flex_none().text_size(11.5).text_color(t.muted).child(w.repo))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).child(w.branch ?? `${w.name} (detached)`))
        .when(Boolean(w.at), (el) => el.child(this.age(t, w)))
        .child(div().flex_none().text_size(10.5).text_color(t.dim).child("Open"))));
    }
    return rows;
  }
}
