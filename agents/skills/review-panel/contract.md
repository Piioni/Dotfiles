# Finding contract

Report real, user-impacting defects only. Style or suspicion is not a finding.

## Finding format

One bullet per finding:

`- [SEVERITY] path:line (or path:start-end) — claim | evidence: deterministic|inferential | cause: introduced|behavior-activated|worsened|pre-existing|unknown | proof: <concrete reference>`

`proof` must be a changed hunk, a command and its output, a differential test, or a before/after comparison. Never a placeholder.

## Severity

- BLOCKER: catastrophic impact or no viable recovery.
- CRITICAL: material user, security, data or correctness failure.
- WARNING: proven non-blocking defect or follow-up risk.
- SUGGESTION: optional concrete improvement.

## Rules for BLOCKER and CRITICAL

- Caused by this change: the behavior does not already happen at `BASE`. Unproved causality is `unknown`, and `unknown` caps at WARNING.
- Reachable with realistic input. Out-of-domain values are at most WARNING.
- Must name the observable harm: a violation of the requested behavior, or a regression on input or state valid at `BASE`.
- Silently ignoring an explicit option or argument while reporting success is severe.
- Unrequested changes to existing command output or messages are severe.
- Behavior that already existed at `BASE` and was not asked to change is `pre-existing`, at most WARNING.
- A change the request asked for is not a regression just because results differ from `BASE`.

## Evidence class

- `deterministic`: reproduced by a command, test or failing assertion. Reading the code and concluding it must misbehave is `inferential`, however obvious the code looks. Only an observed run counts. Reviewers have no execution tools, so they report `deterministic` only when the context itself shows the failure; otherwise the orchestrator upgrades a finding to `deterministic` after the `verifier` reproduced it.
- `inferential`: you reasoned it from the code. Only inferential severe findings go to the refuter.

## Output

Findings list, then one line: `inspected: <paths covered>`. If you could not cover the whole range, say `incomplete: <why>`. When clean: `no findings`, plus `inspected:`.
