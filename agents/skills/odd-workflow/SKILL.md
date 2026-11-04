---
name: odd-workflow
description: "Trigger: implement feature, multi-step change, refactor across files, resume feature, odd, task tracking. Run Organic Driven Development: explore, track tasks, implement per task with commits."
license: Apache-2.0
metadata:
  author: "Piioni"
  version: "1.0"
---

## Activation Contract

Load when the user asks to implement or resume work that needs 2+ meaningful steps or progress worth recovering. Skip for small, understood edits.

## Hard Rules

- Read-only requests (explain, review, plan, compare) never write files or delegate a writer.
- If change intent is ambiguous, ask one question and stay read-only.
- Explore existing code before proposing or writing.
- Substantial work gets `odd/tasks/<feature-name>.md` and an Engram mirror under topic `odd/<feature-name>/tasks` before the first source write.
- Check a task off only after its outcome and checks were observed.
- One writer at a time; never parallel writers.
- Push, PR creation and merge stay with the user.

## Decision Gates

| Situation | Action |
|-----------|--------|
| Small, understood work | Do it inline; no task file |
| Evidence > 3 calls or > 5 lookups | One read-only explorer, handoff ≤ 2k tokens |
| 2+ non-trivial files | One bounded writer with `## Allowed edit surfaces` (exact paths) |
| Runnable deterministic test exists | RED, then GREEN, then refactor |
| No runnable test | State the exception; run a proportionate check |
| Branch on default branch | Create a feature branch first |

## Execution Steps

1. Authorize, then explore proportionately.
2. Classify: substantial means 2+ steps or recoverable progress.
3. Create the task file (objective, scope, checklist with stable IDs, checks) and the Engram mirror; tell the user in one line.
4. Per task: implement, run focused checks, commit with a Conventional Commit (no AI attribution), record the commit in the file, update the mirror.
5. Resume with `mem_context`, `mem_search`, `mem_get_observation`, then the task file; reconcile before continuing.

## Output Contract

Report the verified outcome, every failed, skipped or pending check, and the next step.

## References

- `references/odd-full.md` — original full routing and ODD detail; load only when a rule here is ambiguous.
