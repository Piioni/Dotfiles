// PRs marked addressed: url -> seconds when marked. One stays hidden until GitHub shows activity after that.
export const isAddressed = (pr, marks) => (marks?.[pr.url] ?? 0) >= Date.parse(pr.updatedAt) / 1000;

// Marks only for PRs still listed, so the file doesn't grow.
export const keepListed = (marks, urls) => Object.fromEntries(Object.entries(marks ?? {}).filter(([url]) => urls.has(url)));

// A local card marked addressed lives on its agent's terminal as `<ms>:<turn>`, so it ends with the terminal.
export const ADDRESSED_LABEL = "relevo.addressed";
export const addressedValue = (turn, now = Date.now()) => `${now}:${turn ?? 0}`;

// New work brings the card back: the agent is working or asking, or a turn ended since it was marked.
export const staleAddressed = (value, status, turn) => {
  if (!value) return false;
  const marked = /^\d+:(\d+)$/.exec(value);
  return !marked || status === "working" || status === "blocked" || (turn ?? 0) > Number(marked[1]);
};
