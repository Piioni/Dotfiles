---
name: odd-workflow
description: "Trigger: implement feature, multi-step change, refactor across files, resume feature, odd, task tracking. Run Organic Driven Development: explore, track tasks, implement per task with commits."
license: Apache-2.0
metadata:
  author: "Piioni"
  version: "1.2"
---

## Activation Contract

Load when the user asks to implement or resume work that needs 2+ meaningful steps or progress worth recovering. Skip for small, understood edits.

## Hard Rules

- Read-only requests (explain, review, plan, compare, propose) never write files or delegate a writer.
- If change intent is ambiguous or conditional, ask one question and stay read-only.
- Explore existing code before proposing or writing, proportionately to the request.
- Large work gets `odd/tasks/<feature-name>.md` and an Engram mirror under topic `odd/<feature-name>/tasks` before the first source write.
- Check a task off only after its outcome and checks were observed. Never invent RED/GREEN or any other evidence.
- When the user reports a failure, reproduce it before deciding it already works.
- One writer at a time; never parallel writers.
- Push, PR creation and merge stay with the user.

## Task Size

Small when all three hold: (1) understood: outcome specified, what and where to change known, no open product decision; (2) contained risk: touches no high-risk item; (3) resumable from the diff: if the session stopped now, someone could finish from the original request and `git diff` alone.

Large only when the resume test fails: several sessions, waiting on something external, separate deliverables the user wants apart, or requirements too long to survive compaction. File count, command count, test count or a requested todo list never decide size.

Small: work inline, no task file, no commits unless asked. Large: tracking (feature doc and mirror). Commits follow the user's rule: only when asked; otherwise record `Delivery: no commits` in the feature doc header and leave the work uncommitted.

## High risk and the Risk line

High risk: a mistake is hard to detect, hard to undo, or reaches beyond the change. It touches: (1) data or irreversible effects that cannot be rebuilt (migrations, changing or deleting stored data, persisted format changes); (2) security (auth, permissions, credentials, secrets, guards, sandbox); (3) contracts others consume (changing or removing public API, CLI flags, config formats, published exports; adding an optional flag or command is not); (4) concurrency (locks, races, async ordering); (5) delivery or environment (installers, release, CI, deploy, dependencies); (6) no test would catch a regression in what changes.

Close every code change with `Risk: item N (reason)` or `Risk: none`. Before writing `Risk: none`, check whether the diff changes code that existing behavior the request did not mention also uses (shared options, parsers, helpers); if so that is item 3.

## Decision Gates

| Situation | Action |
|-----------|--------|
| Small, understood work | Inline; no task file |
| Evidence > 3 calls or > 5 lookups | `explorer`, handoff of path:line evidence; re-evaluate task size after |
| 2+ non-trivial files and roughly 100+ changed lines, or heavy parent context | One bounded `worker` with `## Allowed edit surfaces`; smaller changes stay inline even across files |
| Long test suites, builds, or output you would not read | `verifier` returns observed results only |
| Large task finished (diff complete, own checks passed) | Run `ponytail-review` on the diff; apply or report its findings |
| Change names a high-risk item | After its own checks, ask the user whether to run `review-panel` (lenses plus refuter); run it only on a yes |
| High-risk change and `review-panel` already passed | Offer `council` (cross-provider, costly); run it only if the user says yes |
| Runnable deterministic test exists | RED, then GREEN, then refactor |
| No runnable test (config, Nix, docs, skills) | State the exception; run a proportionate check: parse/lint/JSON validation and a leftover grep. No invented RED/GREEN |
| Branch on default branch | Create a feature branch first |
| Same check still fails after 3 attempts (an attempt = a change, then the check), inline or by a `worker` | Stop. Report the last observed output as **Needs your decision**; no fourth attempt |

## Test-first policy

- One RED test per requested rule. Assert every observable effect (output, exit code, persisted data), through the public interface.
- For every existing command or option the change touches (anything sharing the code you changed: options, parsers, helpers, validation), add one test proving its previous behavior still holds.
- Differential check before finishing: run each existing command that shares the changed code with the new or changed input against the previous code (a copy of the base commit in a `mktemp -d` scratch dir, never committed) and against your change; compare stdout, stderr and exit code. Any unrequested difference is a regression to fix and pin with a test.
- Adding or changing a command, option or message updates its help text and docs.
- Scratch state (temp dirs, HOME, TMPDIR, caches) lives outside the worktree in `mktemp -d`; workers report paths, the parent removes them.

## Feature document

Fixed order, stable content first and the growing log last:
1. Header: objective, branch, delivery strategy, test runner (2-3 lines).
2. `## Specs`: numbered `S1..Sn`, quoting the user's exact strings, error messages, commands and examples verbatim in the user's language. Never summarize them and never add requirements nobody asked for; mark assumptions as assumptions.
3. `## Tasks`: one line per task: stable ID, linked `S#`, route (inline or delegated), status, commit or RED/GREEN evidence.
4. `## Log`: last. `L1` is the user's original request verbatim; later corrections, evidence and decisions are appended.

A requirement change appends its verbatim Log entry, rewrites only the affected `S#`, and reopens only its linked task. Update the file and the Engram mirror after each task; read both back (the two writes are not atomic).

## Delegation

- Hand off by reference, not paraphrase: name the document, task and specs (`Spec: odd/tasks/<feature>.md, T2, S3-S4`) and ask the worker which `S#` it covered. Without a feature doc, include the user's request verbatim.
- A `worker` prompt carries: spec reference, `## Allowed edit surfaces` (exact paths, plus directories where new files are authorized), acceptance criteria, `## Verification` commands, the test runner, existing helpers to reuse and the invariants they keep.
- Surfaces are enforced by prompt, not by the system. After a worker returns, compare `git diff --stat` with the allowed surfaces and spot-check one reported command before accepting.
- Do not delegate for size, file count or a price ratio alone. Several small independent changes run inline, one after another.
- Keep the parent's bash output bounded (counts, `--stat`, tail); send long suites and builds to `verifier`.

## Execution Steps

1. Authorize: does the request explicitly authorize a change? If not, stay read-only.
2. Explore proportionately; delegate only a mapping that exceeds the inline budget.
3. Resolve uncertainty: ask one focused question only for a real unresolved product decision, then stop and wait.
4. Classify by Task Size.
5. Track (large only): create the feature doc and the Engram mirror before the first source write; tell the user in one line which document and how many tasks.
6. Per task: implement, run focused checks, record the commit in the file, update the mirror.
7. Close with the Output Contract.
8. Archive (large only): once every task is checked and the user confirms the feature is closed, move the doc to `odd/tasks/done/` and update the mirror with `Status: closed`.

## Delivery

- Applies only once the user asks for commits. Commit work units in reviewable slices of about 400 authored changed lines (planning heuristic, not a hard cap), tests and docs alongside the behavior, Conventional Commit messages, no AI attribution. Branch first when on the default branch.
- A unit whose Risk line names a high-risk item gets its own commit.
- Above ~400 lines across the feature, plan the split with the `work-unit-commits` and `chained-pr` skills before creating any pull request.

## Resume

`mem_context`, then project- and feature-scoped `mem_search`, then `mem_get_observation` for the full document, then the task file itself; reconcile current requirements, code and proof before the next unfinished task.

## Output Contract

Report the verified outcome, every failed, skipped or pending check, the Risk line, and the next step. A partial, blocked, unavailable or exhausted proof becomes one **Needs your decision** result naming what is open, not more verification.
