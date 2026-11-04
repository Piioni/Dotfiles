import { setImmediate } from "node:timers";

// Elements that record what a mod builds: any style call is accepted and ignored.
export function element(kind = "div") {
  const node = { kind, key: null, items: [], handlers: {}, tip: null };
  const el = new Proxy(node, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name === "symbol" || name === "then") return undefined;
      return (...args) => {
        if (name === "id") target.key = args[0];
        else if (name === "child") target.items.push(args[0]);
        else if (name === "children") target.items.push(...args[0]);
        else if (name === "tooltip") target.tip = args[0];
        else if (name === "spin") target.spinning = true;
        else if (name === "when") { if (args[0]) args[1](el); }
        else if (name === "map") return args[0](el);
        else if (name === "hover" || name === "active") args[0](element());
        else if (name.startsWith("on_")) target.handlers[typeof args[0] === "string" ? `${name}:${args[0]}` : name] = args.at(-1);
        return el;
      };
    },
  });
  return el;
}

const kids = (node) => (node && typeof node === "object" ? node.items ?? [] : []);

export function find(root, id) {
  if (root?.key === id) return root;
  for (const child of kids(root)) {
    const hit = find(child, id);
    if (hit) return hit;
  }
  return null;
}

export const spinners = (node) => (node?.spinning === true ? 1 : 0) + kids(node).reduce((sum, child) => sum + spinners(child), 0);

export const text = (node) => (typeof node === "string" || typeof node === "number"
  ? String(node)
  : kids(node).map(text).filter(Boolean).join(" "));

export function fakeCx() {
  const timers = [];
  const cx = {
    timers,
    notified: 0,
    slept: [],
    notify() { cx.notified += 1; },
    stop_propagation() {},
    spawn(body) { return Promise.resolve().then(() => body(cx)); },
    sleep: async (ms) => { cx.slept.push(ms); },
    focus_handle: () => ({ focus() {}, is_focused: () => false, release() {} }),
    timer: {
      every: (ms, fn) => void timers.push({ ms, fn }),
      after: (ms, fn) => void timers.push({ ms, fn, once: true }),
    },
    // Runs the repeating timers of that period.
    fire: (ms) => timers.filter((t) => t.ms === ms && !t.once).forEach((t) => t.fn(cx)),
  };
  return cx;
}

export const click = (node, cx) => node.handlers.on_click({}, cx);

// Lets every spawned task run until it finishes or waits on something a test controls.
export async function flush() {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
}
