// The app's API over state a test sets. Unknown exec calls succeed with no output.
/** @typedef {Record<string, any>} FakeObject */
/** @typedef {{code?:number, stdout?:string, stderr?:string, [key:string]:unknown}} FakeResult */
/** @typedef {{agents:FakeObject[],terminals:FakeObject[],panes:FakeObject[],spaces:FakeObject[],layout:FakeObject,focused:FakeObject|null,props:FakeObject,window:{platform:"linux"|"macos"|"windows",titlebar:string,active:boolean},stored:Record<string,any>,files:Record<string,string>,read:((path:string)=>string|null|Promise<string|null>)|null,write:((path:string,body:string,expected:string|null)=>unknown)|null,exec:(cmd:string,args:string[],options:FakeObject)=>FakeResult|null|Promise<FakeResult|null>,execs:string[],runs:any[][],notices:FakeObject[],overlays:FakeObject[],folderChanges:Map<string,unknown>,folderWaits:Map<string,(changed:unknown)=>void>}} FakeState */
const never = new Promise(() => {});
/** @returns {FakeState} */
const blank = () => ({
  agents: [], terminals: [], panes: [], spaces: [], layout: { id: "root", children: [] }, focused: null, props: {},
  window: { platform: /** @type {"linux"|"macos"|"windows"} */ ("macos"), titlebar: "none", active: true }, stored: {}, files: {},
  read: null, write: null, exec: () => null, execs: [], runs: [], notices: [], overlays: [], folderChanges: new Map(), folderWaits: new Map(),
});

export const fake = blank();
export const resetFake = () => Object.assign(fake, blank());
// Git and hc calls made so far, as "cmd arg arg".
/** @param {RegExp} pattern */
export const calls = (pattern) => fake.execs.filter((line) => pattern.test(line));
/** @param {string} path @param {unknown} changed */
export function changeFolder(path, changed) {
  const waiting = fake.folderWaits.get(path);
  if (waiting) {
    fake.folderWaits.delete(path);
    waiting(changed);
  } else fake.folderChanges.set(path, changed);
}
/** @returns {string[]} */
export const watched = () => [...fake.folderWaits.keys()];

const palette = new Proxy({}, { get: (_t, name) => (typeof name === "string" ? `#${name}` : undefined) });

/** @returns {FakeObject[]} */
export const agents = () => fake.agents;
/** @returns {FakeObject[]} */
export const terminals = () => fake.terminals;
/** @returns {FakeObject[]} */
export const panes = () => fake.panes;
/** @returns {FakeObject[]} */
export const spaces = () => fake.spaces;
export const layout = () => fake.layout;
export const focused = () => fake.focused;
export const props = () => fake.props;
export const window = () => fake.window;
export const theme = () => palette;
export const settings = () => ({ zoom: 1 });
export const home = () => "/home/test";
export const appHome = () => "/home/test/.config/herdr-app";
/** @param {string} key */
export const shared = (key) => fake.stored[key];
/** @param {string} key @param {unknown} value @returns {null} */
export const setShared = (key, value) => { fake.stored[key] = value; return null; };
/** @param {string} name @param {unknown} args */
export const run = (name, args) => { fake.runs.push([name, args]); };
/** @param {FakeObject} notice */
export const notify = (notice) => { fake.notices.push(notice); };
/** @param {FakeObject} overlay */
export const openOverlay = (overlay) => { fake.overlays.push(overlay); }
export const closeOverlay = () => {};
export const playSound = () => {};
/** @returns {null} */
export const setAgentOrder = () => null;
export const nextCommand = () => never;
/** @param {string} path @returns {Promise<string|null>} */
export const readTextFile = async (path) => (fake.read ? fake.read(path) : fake.files[path] ?? null);
/** @param {string} path @param {string} body @param {string|null} expected */
export const writeTextFile = async (path, body, expected) => {
  if (fake.write) return fake.write(path, body, expected);
  fake.files[path] = body;
};
/** @param {string} cmd @param {string[]} [args] @param {FakeObject} [options] @returns {Promise<FakeResult>} */
export const exec = async (cmd, args = [], options = {}) => {
  fake.execs.push([cmd, ...args].join(" "));
  return { code: 0, stdout: "", stderr: "", ...(await fake.exec(cmd, args, options)) };
};
/** @param {string} path @returns {Promise<unknown>} */
export const watchFolder = (path) => {
  const ready = fake.folderChanges.get(path);
  if (ready) {
    fake.folderChanges.delete(path);
    return Promise.resolve(ready);
  }
  return new Promise((resolve) => fake.folderWaits.set(path, resolve));
};
