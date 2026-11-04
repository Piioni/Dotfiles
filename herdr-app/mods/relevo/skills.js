import { shared, setShared } from "herdr";
import { launchInRepo } from "./accounts.js";
import { SKILLS as SKILL_NAMES } from "./config.js";

// PRs a skill was started on, so a card can follow its agent: url -> {tab, skill, account, at}.
export const LAUNCHED = "relevo.launched";
export const SKILLS = Object.fromEntries(Object.entries(SKILL_NAMES).map(([verb, name]) => [verb, { name, verb }]));
export const launched = () => shared(LAUNCHED) ?? {};
const tabName = (pr, skill) => `${pr.repo.split("/")[1]}#${pr.number} · ${SKILLS[skill].verb}`;

// Starts the skill on the PR and remembers it, so the card can follow its agent.
export function launchSkill(pr, skill, account, folder) {
  const tab = tabName(pr, skill);
  launchInRepo({ repo: pr.repo, folder, tab, account, prompt: `/${SKILLS[skill].name} ${pr.url}` });
  setShared(LAUNCHED, { ...launched(), [pr.url]: { tab, skill, account, at: Date.now() / 1000 } });
}
