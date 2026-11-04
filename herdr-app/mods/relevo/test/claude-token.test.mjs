// bin/claude-token with stub secret-tool and claude executables: no real keyring or Claude runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../bin/claude-token", import.meta.url).pathname;

/** @param {Record<string, string>} tokens @param {(run: (args: string[], env?: Record<string, string>) => import("node:child_process").SpawnSyncReturns<string>, root: string) => void} body */
function withStubs(tokens, body) {
  const root = mkdtempSync(join(tmpdir(), "claude-token-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const [name, token] of Object.entries(tokens)) writeFileSync(join(root, `token-${name}`), token);
    const stub = (/** @type {string} */ file, /** @type {string} */ text) => {
      writeFileSync(join(bin, file), `#!/bin/sh\n${text}\n`);
      chmodSync(join(bin, file), 0o755);
    };
    stub("secret-tool", `[ "$1 $2 $3 $4 $5" = "lookup service claude account $5" ] && cat "${root}/token-$5" 2>/dev/null`);
    stub("claude", `touch "${root}/ran"; printf '%s|%s|%s|%s|%s\\n' "$CLAUDE_CODE_OAUTH_TOKEN" "$RELEVO_ACCOUNT" "\${CLAUDE_CONFIG_DIR-unset}" "\${ANTHROPIC_API_KEY-unset}" "\${ANTHROPIC_AUTH_TOKEN-unset}"; for a in "$@"; do printf 'arg:%s\\n' "$a"; done`);
    const run = (/** @type {string[]} */ args, /** @type {Record<string, string>} */ env = {}) =>
      spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin`, HOME: "/home/x", ...env } });
    body(run, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("no token in the keyring: exits 1 and never starts Claude", () => {
  withStubs({}, (run, root) => {
    const r = run(["work", ".claude-sipos"]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /no token for 'work'/);
    assert.equal(existsSync(join(root, "ran")), false);
  });
});

test("starts Claude as the account with its token, in that profile folder, passing the arguments through", () => {
  withStubs({ personal: "sk-ant-oat01-aaa" }, (run) => {
    const r = run(["personal", ".claude-sipos", "--resume", "id", "--fork-session", "two words"]);
    assert.equal(r.status, 0);
    assert.deepEqual(r.stdout.trim().split("\n"), [
      "sk-ant-oat01-aaa|personal|/home/x/.claude-sipos|unset|unset", "arg:--resume", "arg:id", "arg:--fork-session", "arg:two words",
    ]);
  });
});

test("the default folder is left to Claude, and inherited credentials that outrank the token are dropped", () => {
  withStubs({ work: "tok" }, (run) => {
    const r = run(["work", ".claude"], { CLAUDE_CONFIG_DIR: "/other", ANTHROPIC_API_KEY: "key", ANTHROPIC_AUTH_TOKEN: "auth" });
    assert.equal(r.stdout.trim(), "tok|work|unset|unset|unset");
  });
});

test("an account or folder that is not a plain name is refused before any lookup", () => {
  withStubs({ work: "tok" }, (run, root) => {
    for (const args of [["work", "../x"], ["work", "a/b"], ["work", "claude"], ["wo rk", ".claude"], ["work"], []]) {
      assert.notEqual(run(args).status, 0, args.join(" "));
    }
    assert.equal(existsSync(join(root, "ran")), false);
  });
});
