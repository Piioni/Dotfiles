import { test } from "node:test";
import assert from "node:assert/strict";
import * as mine from "../config.js";
import * as example from "../config.example.js";
import { validate } from "../lib/settings.js";

// Runtime and template must both satisfy the configuration accepted by Settings.
/** @type {Array<[string, Record<string, any>]>} */
const setups = [["config.js", mine], ["config.example.js", example]];
for (const [name, config] of setups) {
  test(`${name}: a complete, consistent setup`, () => {
    assert.deepEqual(validate(config), []);
  });
}
