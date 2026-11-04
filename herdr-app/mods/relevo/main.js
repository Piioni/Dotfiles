import { View } from "gpui-kit";
import { props, nextCommand, notify } from "herdr";
import { LAUNCHERS } from "./accounts.js";
import { Sidebar } from "./sidebar.js";
import { Inbox } from "./inbox.js";
import { InboxButton, PanelToggle, showPanel } from "./toolbar.js";
import { AccountMenu } from "./account-menu.js";
import { PanelBar, FileFinder, CheckoutMenu, openFinder, openCheckoutsHere } from "./panelbar.js";
import { nextWaiting, openPR, respondPR, worktrees } from "./commands.js";
import { Handoff, openHandoff, handoffFrom, closeHandedOff } from "./handoff.js";
import { Fallback } from "./fallback.js";
import { ReviewDiff, openReview } from "./review.js";
import { loadKeys } from "./ui.js";
import { LedgerWeek, openWeek } from "./week.js";
import { Settings, openSettings } from "./settings.js";
import { focusInbox } from "./inbox-keys.js";

/** @type {Record<string, new () => any>} */
const ROLES = {
  accounts: Sidebar, inbox: Inbox, "inbox-button": InboxButton, "account-menu": AccountMenu,
  "panel-bar": PanelBar, "panel-toggle": PanelToggle, "find-file": FileFinder, "checkout-menu": CheckoutMenu,
  handoff: Handoff, fallback: Fallback, "review-diff": ReviewDiff, "ledger-week": LedgerWeek, settings: Settings,
};

export default class Relevo extends View {
  /** @param {unknown} _props @param {import("gpui-kit").Context} cx */
  init(_props, cx) {
    const role = props()?.role ?? "accounts";
    this.part = new (ROLES[role] ?? Sidebar)();
    this.part.init?.(props(), cx);
    cx.spawn(async (cx) => {
      await loadKeys();
      cx.notify();
    });
    // keys.json "relevo.<command>"; only the sidebar copy listens, so each runs once.
    if (role === "accounts") {
      cx.spawn(async (cx) => {
        for (;;) this.command(await nextCommand(), cx);
      });
    }
  }

  /** @param {string} name @param {import("gpui-kit").AsyncContext} cx */
  command(name, cx) {
    if (name === "find-file") openFinder();
    else if (name === "next-waiting") nextWaiting();
    else if (name === "handoff") openHandoff();
    else if (name === "ledger-week") openWeek();
    else if (name === "checkouts") cx.spawn(async () => {
      await openCheckoutsHere();
    });
    else if (name === "settings") openSettings();
    else if (name.startsWith("handoff-from-")) handoffFrom(name.slice(13));
    else if (name.startsWith("handoff-agent-")) openHandoff(name.slice(14));
    else if (name.startsWith("handoff-close-")) {
      const [old, next] = name.slice(14).split(":");
      if (old && next) closeHandedOff(old, next);
    }
    else if (name === "review") cx.spawn(async () => { await openReview(); });
    else if (name === "open-pr") cx.spawn(async () => { await openPR(); });
    else if (name === "respond-pr") cx.spawn(async () => { await respondPR(); });
    else if (name.startsWith("worktree-")) worktrees(name.slice(9));
    else if (name === "panel-inbox") focusInbox();
    else if (name.startsWith("panel-")) showPanel(name.slice(6));
    else if (name.startsWith("launch-profile-")) {
      const profile = LAUNCHERS.find((l) => l.key === name.slice("launch-profile-".length));
      if (profile) this.part.launch(profile);
      else notify({ title: "Launcher no longer exists", level: "warning" });
    }
    else if (name.startsWith("launch-")) this.part.launch(name.slice(7));
  }

  /** @param {import("gpui-kit").AsyncContext} cx */
  async close(cx) {
    await this.part.close?.(cx);
  }

  /** @param {import("gpui-kit").Context} cx */
  render(cx) {
    return this.part.render(cx);
  }
}
