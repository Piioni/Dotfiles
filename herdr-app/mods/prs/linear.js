// The Linear issue behind a branch key (POS-941), asked by identifier. Same approach as the Linear mod: the API key is read from
// ~/.config/linear/token (never on a command line) and sent to the GraphQL endpoint with fetch.
import * as fs from "fs/promises";
import { home } from "herdr";

const QUERY = "query($id: String!) { issue(id: $id) { identifier title url state { name type color } } }";

/** @param {string} key @returns {Promise<{ identifier: string, title: string, url: string, state: { name: string, type: string, color: string } } | null>} null = no key or no such issue */
export async function fetchIssue(key) {
  const token = (await fs.readFile(`${home()}/.config/linear/token`, "utf8").catch(() => "")).trim();
  if (!token) return null;
  const res = await fetch("https://api.linear.app/graphql", { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ query: QUERY, variables: { id: key } }) });
  /** @type {any} */
  const body = await res.json().catch(() => /** @type {any} */ (null));
  return body?.data?.issue ?? null;
}
