// Catppuccin Mocha icons (MIT, github.com/catppuccin/vscode-icons) in mods/piioni-files/icons/.
const DIR = "mods/piioni-files/icons";

/** @type {Record<string, string>} */
const BY_NAME = {
  "package.json": "package-json", "package-lock.json": "npm-lock", "pnpm-lock.yaml": "pnpm-lock", "yarn.lock": "yarn-lock",
  "bun.lock": "bun-lock", "bun.lockb": "bun-lock", "cargo.toml": "cargo", "cargo.lock": "cargo-lock", "go.mod": "go-mod",
  "tsconfig.json": "typescript-config", "dockerfile": "docker", "docker-compose.yml": "docker-compose",
  "docker-compose.yaml": "docker-compose", "compose.yml": "docker-compose", "compose.yaml": "docker-compose",
  ".dockerignore": "docker-ignore", ".gitignore": "git", ".gitattributes": "git", ".gitmodules": "git",
  "makefile": "makefile", "justfile": "just", "readme.md": "readme", "license": "license", "license.md": "license",
  "changelog.md": "changelog", ".editorconfig": "editorconfig", ".envrc": "envrc", ".prettierrc": "prettier",
  "flake.nix": "nix", "flake.lock": "nix-lock", "taskfile.yml": "taskfile", "deno.json": "deno", "stylua.toml": "stylua",
  "codeowners": "codeowners", "robots.txt": "robots",
};

const BY_PREFIX = [
  [".env", "env"], ["vite.config", "vite"], ["tailwind.config", "tailwind"], ["eslint.config", "eslint"], [".eslintrc", "eslint"],
  ["webpack.config", "webpack"], ["rollup.config", "rollup"], ["next.config", "next"], ["nuxt.config", "nuxt"],
  ["astro.config", "astro-config"], ["svelte.config", "svelte-config"], ["jest.config", "jest"], ["vitest.config", "vitest"],
  ["prettier.config", "prettier"], ["postcss.config", "postcss"], ["biome.json", "biome"],
];

/** @type {Record<string, string>} */
const BY_EXT = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript-react", ts: "typescript", mts: "typescript",
  cts: "typescript", tsx: "typescript-react", json: "json", jsonc: "json", json5: "json", md: "markdown", mdx: "markdown-mdx",
  py: "python", rs: "rust", go: "go", lua: "lua", sh: "bash", bash: "bash", zsh: "bash", fish: "bash", nu: "bash",
  nix: "nix", toml: "toml", yaml: "yaml", yml: "yaml", css: "css", scss: "sass", sass: "sass", less: "less", html: "html",
  htm: "html", svg: "svg", png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", ico: "image", avif: "image",
  mp3: "audio", wav: "audio", flac: "audio", ogg: "audio", mp4: "video", mkv: "video", webm: "video", mov: "video",
  zip: "zip", tar: "zip", gz: "zip", xz: "zip", "7z": "zip", pdf: "pdf", java: "java", jar: "java-jar", kt: "kotlin",
  c: "c", h: "c-header", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp-header", cs: "csharp", rb: "ruby", php: "php",
  swift: "swift", dart: "dart", vue: "vue", svelte: "svelte", astro: "astro", sql: "database", db: "database",
  sqlite: "database", lock: "lock", env: "env", txt: "text", log: "log", xml: "xml", csv: "csv", ex: "elixir", exs: "elixir",
  hs: "haskell", zig: "zig", vim: "vim", conf: "config", ini: "config", cfg: "config", theme: "config", diff: "diff",
  patch: "diff", graphql: "graphql", gql: "graphql", proto: "proto", tf: "terraform", kdl: "kdl", just: "just",
  ttf: "font", otf: "font", woff: "font", woff2: "font", wasm: "web-assembly", ps1: "powershell", bat: "batch",
  tex: "latex", ipynb: "jupyter", jl: "julia", r: "r", scala: "scala", clj: "clojure", ml: "ocaml", erl: "erlang",
  exe: "exe", key: "key", pem: "certificate", crt: "certificate", env_example: "env",
};

/** @type {Record<string, string>} */
const FOLDERS = {
  src: "src", components: "components", lib: "lib", utils: "utils", util: "utils", test: "tests", tests: "tests",
  __tests__: "tests", spec: "tests", docs: "docs", doc: "docs", config: "config", configs: "config", scripts: "scripts",
  node_modules: "node", ".git": "git", ".github": "github", ".gitlab": "gitlab", public: "public", assets: "assets",
  images: "images", img: "images", styles: "styles", css: "styles", types: "types", hooks: "hooks", nix: "nix", dist: "dist",
  build: "dist", out: "dist", api: "api", server: "server", client: "client", database: "database", db: "database",
  docker: "docker", k8s: "kubernetes", kubernetes: "kubernetes", ".vscode": "vscode", packages: "packages", plugins: "plugins",
  templates: "templates", themes: "themes", views: "views", routes: "routes", controllers: "controllers",
  middleware: "middleware", core: "core", shared: "shared", locales: "locales", i18n: "locales", fonts: "fonts",
  mocks: "mocks", examples: "examples", tmp: "temp", temp: "temp", layouts: "layouts", composables: "composables",
  constants: "constant", ".husky": "husky", workflows: "workflows", linux: "linux", macos: "macos", windows: "windows",
  video: "video", audio: "audio", private: "private", security: "security", scripts_: "scripts", functions: "functions",
  messages: "messages", queue: "queue", download: "download", downloads: "download", upload: "upload",
};

/** @param {string} name */
const icon = (name) => `${DIR}/${name}.svg`;

/** Path of the icon for a file or folder entry (folders: `open` picks the open variant).
 * @param {string} name @param {boolean} [dir] @param {boolean} [open] */
export function iconFor(name, dir, open) {
  const lower = name.toLowerCase();
  if (dir) {
    const kind = FOLDERS[lower];
    return icon(kind ? `folder_${kind}${open ? "_open" : ""}` : `_folder${open ? "_open" : ""}`);
  }
  const named = BY_NAME[lower] ?? BY_PREFIX.find(([p]) => lower.startsWith(p))?.[1];
  if (named) return icon(named);
  const dot = lower.lastIndexOf(".");
  return icon((dot > 0 || dot === 0 ? BY_EXT[lower.slice(dot + 1)] : undefined) ?? "_file");
}

// Every icon name this file can return, so a script can check they all exist on disk.
export const ICON_NAMES = [...new Set([
  ...Object.values(BY_NAME), ...BY_PREFIX.map(([, n]) => n), ...Object.values(BY_EXT), "_file", "_folder", "_folder_open",
  ...Object.values(FOLDERS).flatMap((k) => [`folder_${k}`, `folder_${k}_open`]),
])];
