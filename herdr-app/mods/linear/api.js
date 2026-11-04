import * as fs from "fs/promises";

const URL = "https://api.linear.app/graphql";
const OPEN = 150;   // open tasks per scope
const DONE = 40;    // and the most recently touched finished ones
const SEARCH = 40;  // results of a workspace search
const VIEW_ISSUES = 250;  // issues of a saved view
const RECENT = "-P30D";

const FIELDS = `identifier title url branchName priority createdAt updatedAt completedAt dueDate
  state { name type color position } team { key } project { name color } parent { identifier }
  assignee { name displayName }
  children(first: 50) { nodes { state { type } } }
  labels(first: 6) { nodes { name color } }
  attachments(first: 6) { nodes { sourceType url title } }`;

const OPEN_STATE = `state: { type: { nin: ["completed", "canceled"] } }`;
const DONE_STATE = `state: { type: { in: ["completed", "canceled"] } }, updatedAt: { gte: "${RECENT}" }`;

export const MINE = "assigned";

const STATES = `states: workflowStates(first: 250) { nodes { name type color position } }`;

// My issues: the open ones, the recently finished ones and the workflow's statuses.
const mine = (me) => `{
  open: issues(first: ${OPEN}, filter: { assignee: { id: { eq: "${me}" } }, ${OPEN_STATE} }) { nodes { ${FIELDS} } }
  done: issues(first: ${DONE}, orderBy: updatedAt, filter: { assignee: { id: { eq: "${me}" } }, ${DONE_STATE} }) { nodes { ${FIELDS} } }
  ${STATES}
}`;

// A saved Linear view: the most recently touched issues it holds.
const saved = (slug) => `{
  view: customView(id: ${JSON.stringify(slug)}) { issues(first: ${VIEW_ISSUES}, orderBy: updatedAt) { nodes { ${FIELDS} } } }
  ${STATES}
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

export async function fetchTasks(token, me, source) {
  if (source === MINE) {
    const data = await gql(token, mine(me));
    return { tasks: [...data.open.nodes, ...data.done.nodes], states: data.states.nodes };
  }
  const data = await gql(token, saved(source));
  if (!data.view) throw new LinearError("api", "That Linear view no longer exists");
  return { tasks: data.view.issues.nodes, states: data.states.nodes };
}

// The issue views of the workspace, with the display options each was saved with.
export async function fetchViews(token, me) {
  const data = await gql(token, `{ customViews(first: 100) { nodes { name slugId color modelName owner { id displayName } viewPreferencesValues {
    viewOrdering viewOrderingDirection issueGrouping issueSubGrouping showCompletedIssues showSubIssues showTriageIssues } } } }`);
  return data.customViews.nodes.filter((v) => v.modelName === "Issue").map((v) => ({
    slug: v.slugId, name: v.name, color: v.color, owner: v.owner?.displayName ?? "", mine: v.owner?.id === me, prefs: v.viewPreferencesValues ?? {},
  }));
}

// Searches the whole workspace, not only what the person is involved in.
export async function searchTasks(token, term) {
  const data = await gql(token, `{ searchIssues(term: ${JSON.stringify(term)}, first: ${SEARCH}) { nodes { ${FIELDS} } } }`);
  return data.searchIssues.nodes;
}
