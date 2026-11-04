// Which number an account's quota bars show when its sources disagree.
import "./fake/register.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fake, resetFake } from "./fake/herdr.mjs";

const { ACCOUNTS, API_QUOTAS, currentWindow, loadClaudeQuotas } = await import("../accounts.js");
const NOW = Date.now() / 1000, SOON = NOW + 3600, LATER = NOW + 7200, GONE = NOW - 60;
const key = ACCOUNTS[0].key, FILE = `/home/test/.cache/herdr-relevo/quota-${key}.json`;
const window = (used_percentage, resets_at) => ({ used_percentage, resets_at });
const snapshot = (rate_limits, updated = NOW) => JSON.stringify({ updated, rate_limits });
const api = (rate_limits, updated) => { fake.stored[API_QUOTAS] = { [key]: { updated, rate_limits } }; };
const quota = async () => (await loadClaudeQuotas())[key];

beforeEach(resetFake);

test("currentWindow: the first source with a live window, else what's known", () => {
  const source = (five_hour) => ({ rate_limits: { five_hour } });
  assert.equal(currentWindow([source(window(5, LATER)), source(window(98, SOON))], "five_hour", NOW).used_percentage, 5);
  assert.equal(currentWindow([source(undefined), source(window(98, SOON))], "five_hour", NOW).used_percentage, 98);
  assert.equal(currentWindow([source(window(98, GONE)), source(window(5, LATER))], "five_hour", NOW).used_percentage, 5);
  assert.equal(currentWindow([source(window(98, GONE))], "five_hour", NOW).resets_at, GONE);
  assert.equal(currentWindow([source(undefined)], "five_hour", NOW), undefined);
});

test("a newer source missing a window doesn't empty that bar", async () => {
  fake.files[FILE] = snapshot({ seven_day: window(77, LATER) }, NOW + 15);
  api({ five_hour: window(38, SOON), seven_day: window(85, LATER) }, NOW);
  const q = await quota();
  assert.equal(q.h5.pct, 38);
  assert.equal(q.d7.pct, 77);
});

test("a value can come down: an early reset, a new login or a new plan", async () => {
  fake.files[FILE] = snapshot({ seven_day: window(100, LATER) }, NOW);
  assert.equal((await quota()).d7.pct, 100);
  api({ seven_day: window(2, NOW + 90000) }, NOW + 30);
  assert.equal((await quota()).d7.pct, 2);
  fake.files[FILE] = snapshot({ seven_day: window(30, LATER) }, NOW + 60);
  assert.equal((await quota()).d7.pct, 30);
});

test("a window that ended shows as reset unless another source has the new one", async () => {
  fake.files[FILE] = snapshot({ five_hour: window(99, GONE) });
  assert.equal((await quota()).h5.pct, 0);
  api({ five_hour: window(3, LATER) }, NOW - 300);
  assert.equal((await quota()).h5.pct, 3);
});

test("an account with nothing known stays empty", async () => {
  assert.equal((await quota()), null);
});
