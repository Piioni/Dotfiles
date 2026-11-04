import "./fake/register.mjs";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fake, resetFake } from "./fake/herdr.mjs";

const { collectQuotas } = await import("../quota.js");
const credentialsPath = "/home/test/.claude/.credentials.json";
const codexCredentialsPath = "/home/test/.codex/auth.json";
const token = "test-oauth-token";
/** @type {typeof globalThis.fetch} */
let fetchBefore;

beforeEach(() => {
  resetFake();
  fetchBefore = globalThis.fetch;
});
afterEach(() => { globalThis.fetch = fetchBefore; });

test("Claude quota reads the configured Linux credentials file without refreshing or writing tokens", async () => {
  fake.files[credentialsPath] = JSON.stringify({
    claudeAiOauth: { accessToken: token, expiresAt: Date.now() + 60_000 },
  });
  const requests = /** @type {{url:string, authorization:string|null}[]} */ ([]);
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), authorization: new Headers(options?.headers).get("Authorization") });
    return new Response(JSON.stringify({ five_hour: { utilization: 42, resets_at: "2030-01-01T00:00:00Z" } }), { status: 200 });
  };

  const result = await collectQuotas();

  assert.equal(result.personal.rate_limits.five_hour.used_percentage, 42);
  const request = requests.find((r) => r.url === "https://api.anthropic.com/api/oauth/usage");
  assert.ok(request);
  assert.equal(request.authorization, `Bearer ${token}`);
  assert.deepEqual(fake.execs, []);
  assert.deepEqual(Object.keys(fake.files), [credentialsPath]);
  assert.equal(JSON.stringify(result).includes(token), false);
});

test("expired or absent Claude credentials fail without making a usage request", async () => {
  const requests = /** @type {string[]} */ ([]);
  globalThis.fetch = async (url) => { requests.push(String(url)); throw new Error("should not request"); };
  fake.files[credentialsPath] = JSON.stringify({
    claudeAiOauth: { accessToken: token, expiresAt: Date.now() - 1 },
  });

  const expired = await collectQuotas();
  assert.match(expired.personal.error, /expired/i);
  assert.equal(requests.includes("https://api.anthropic.com/api/oauth/usage"), false);
  assert.equal(JSON.stringify(expired).includes(token), false);
});

test("missing Codex access token fails without making an authenticated request", async () => {
  const requests = /** @type {string[]} */ ([]);
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ rate_limit: {} }), { status: 200 });
  };

  const result = await collectQuotas();

  assert.deepEqual(result.codex, { error: "no Codex credentials" });
  assert.deepEqual(requests, []);
  assert.deepEqual(fake.execs, []);
  assert.deepEqual(Object.keys(fake.files), []);
});

test("malformed or empty Codex credentials fail without a usage request", async () => {
  const requests = /** @type {string[]} */ ([]);
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    return new Response(JSON.stringify({ rate_limit: {} }), { status: 200 });
  };
  const invalidCredentials = /** @type {Array<[string, string, string]>} */ ([
    ["malformed", "{", "invalid Codex credentials"],
    ["empty", JSON.stringify({ tokens: { access_token: "" } }), "no Codex credentials"],
  ]);

  for (const [, contents, error] of invalidCredentials) {
    fake.files[codexCredentialsPath] = contents;
    const result = await collectQuotas();
    assert.equal(result.codex.error, error);
    assert.deepEqual(requests, []);
    assert.deepEqual(Object.keys(fake.files), [codexCredentialsPath]);
    assert.equal(fake.files[codexCredentialsPath], contents);
    assert.deepEqual(fake.execs, []);
  }
});

test("a Codex HTTP failure leaves Claude quotas available and does not expose its token", async () => {
  const codexToken = "test-codex-token";
  const codexAuth = JSON.stringify({ tokens: { access_token: codexToken } });
  fake.files[credentialsPath] = JSON.stringify({
    claudeAiOauth: { accessToken: token, expiresAt: Date.now() + 60_000 },
  });
  fake.files[codexCredentialsPath] = codexAuth;
  const requests = /** @type {string[]} */ ([]);
  globalThis.fetch = async (url) => {
    const address = String(url);
    requests.push(address);
    if (address === "https://api.anthropic.com/api/oauth/usage") {
      return new Response(JSON.stringify({ five_hour: { utilization: 42 } }), { status: 200 });
    }
    return new Response("", { status: 500 });
  };

  const result = await collectQuotas();

  assert.equal(result.personal.rate_limits.five_hour.used_percentage, 42);
  assert.deepEqual(result.codex, { error: "HTTP 500" });
  assert.deepEqual(requests.sort(), [
    "https://api.anthropic.com/api/oauth/usage",
    "https://chatgpt.com/backend-api/wham/usage",
  ]);
  assert.equal(JSON.stringify(result).includes(codexToken), false);
  assert.equal(fake.files[codexCredentialsPath], codexAuth);
  assert.deepEqual(fake.execs, []);
});
