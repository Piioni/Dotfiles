import * as fs from "fs/promises";

const URL = "https://api.linear.app/graphql";
const OPEN = 150;   // open tasks per scope
const DONE = 40;    // and the most recently touched finished ones
const RECENT = "-P30D";

const FIELDS = `identifier title url branchName priority createdAt updatedAt completedAt dueDate
  state { name type color position } team { key } project { name color } parent { identifier }
  assignee { name displayName }
  children(first: 50) { nodes { state { type } } }
  labels(first: 6) { nodes { name color } }
  attachments(first: 6) { nodes { sourceType url title } }`;

const OPEN_STATE = `state: { type: { nin: ["completed", "canceled"] } }`;
const DONE_STATE = `state: { type: { in: ["completed", "canceled"] } }, updatedAt: { gte: "${RECENT}" }`;

const WHO = {
  assigned: (me) => `assignee: { id: { eq: "${me}" } }`,
  created: (me) => `creator: { id: { eq: "${me}" } }`,
  subscribed: (me) => `subscribers: { some: { id: { eq: "${me}" } } }`,
};
export const SCOPE_NAMES = Object.keys(WHO);

// One request per scope: the open tasks, the recently finished ones and the workflow's statuses.
const query = (scope, me) => `{
  open: issues(first: ${OPEN}, filter: { ${WHO[scope](me)}, ${OPEN_STATE} }) { nodes { ${FIELDS} } }
  done: issues(first: ${DONE}, orderBy: updatedAt, filter: { ${WHO[scope](me)}, ${DONE_STATE} }) { nodes { ${FIELDS} } }
  states: workflowStates(first: 250) { nodes { name type color position } }
}`;

export class LinearError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

export async function readToken(path) {
  const token = (await fs.readFile(path, "utf8").catch(() => "")).trim();
  if (!token) throw new LinearError("token", "No Linear API key");
  return token;
}

async function gql(token, query) {
  const res = await fetch(URL, { method: "POST", headers: { Authorization: token, "Content-Type": "application/json" }, body: JSON.stringify({ query }) });
  if (res.status === 401 || res.status === 403) throw new LinearError("auth", "Linear rejected the API key");
  const body = await res.json().catch(() => null);
  if (!body || body.errors?.length) throw new LinearError("api", body?.errors?.[0]?.message ?? `Linear answered ${res.status}`);
  return body.data;
}

export const viewer = async (token) => (await gql(token, `{ viewer { id name displayName } }`)).viewer;

export async function fetchTasks(token, me, scope) {
  const data = await gql(token, query(scope, me));
  return { tasks: [...data.open.nodes, ...data.done.nodes], states: data.states.nodes };
}
