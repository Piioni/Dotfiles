import { exec, run, terminals, panes, focused } from "herdr";

/** Any command in a new tab. */
export function openTab(folder, argv, name) {
  run("tab.new", { name, folder, argv });
}

// Any command as a sub-agent of a terminal in the current tab, shown with terminal.peek.
// The app needs a moment to learn about a new terminal, so the peek retries for ~5s.
// It ends with its parent terminal; with no terminal to hang from, it falls back to a tab.
export function openPopup(folder, argv, name, cx) {
  const f = focused();
  const parent = f?.terminal ?? panes().find((p) => p.tab === f?.tab && p.terminal)?.terminal;
  if (!parent) return openTab(folder, argv, name);
  cx.spawn(async (cx) => {
    try {
      const r = await exec("hc", ["run", "--bg", "--json", "--parent", parent, "--no-notify", "--rm", "--cwd", folder, "--", ...argv]);
      const address = JSON.parse(r.stdout).address;
      let tries = 0;
      const peek = (cx) => {
        if (terminals().some((t) => t.address === address)) run("terminal.peek", { terminal: address });
        else if (++tries < 25) cx.timer.after(200, peek);
      };
      peek(cx);
    } catch { openTab(folder, argv, name); }
  });
}

const base = (file) => file.split("/").pop();
export const helixTab = (folder, file) => openTab(folder, ["hx", file], base(file));
export const helixPopup = (folder, file, cx) => openPopup(folder, ["hx", file], base(file), cx);
