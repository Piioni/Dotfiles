---
name: review-panel
description: >
  Trigger: review panel, review by lenses, review this diff/branch/PR with a refuter,
  revisión por lentes. Run independent lens reviewers over a fixed git range, merge their
  findings, then try to refute the severe inferential ones before reporting.
---

# Review Panel

Not a replacement for `council` (cross-provider).
Use this when the review should follow explicit criteria and every severe claim must survive a refuter.

## Procedure

1. **Fix the target.** Pick `BASE` and `HEAD` (`git merge-base <default-branch> HEAD`, or what the user gave), then run
   `bash <skill-dir>/review-context.sh BASE HEAD`. It prints the path of a frozen context file (diff, commit bodies);
   keep only that path. Every reviewer reads the same file; never review the live worktree.
   Note whether the worktree is at `HEAD` (`git rev-parse HEAD`) for the refuter. Remove the context dir when done.
2. **Pick lenses** from `lenses/` by consequence, only those that apply (max 4). Add repo-specific lenses from `<repo>/.claude/review-lenses/*.md` if present.
   - `risk`: could expose, lose or irreversibly change data, credentials, permissions, contracts.
   - `resilience`: changes behavior under failure, retries, timeouts, partial writes, load.
   - `readability`: changes what others read or depend on (public API, messages, docs, structure).
   - `reliability`: changes logic or observable behavior that tests should pin.
3. **Launch one `reviewer` per lens, in parallel in a single message.** Prompt each with:
   the context file path, the absolute path of its lens file, and the absolute path of `contract.md`.
   Reviewers have only `Read`: they cannot run commands, so their findings are `inferential` unless the context itself shows proof.
4. **Merge.** Dedupe by `location` + claim, keep the highest severity, keep every lens that found it.
5. **Reproduce (optional).** For severe findings a command can confirm (a failing test, a build, a probe), pass the exact commands to the `verifier`.
   A finding it reproduces becomes `evidence: deterministic` and skips the refuter. The verifier executes code (also a PR's, under bypassPermissions); the user allowed it on any branch, so say in one line that it will run the PR's code.
6. **Refute.** Send BLOCKER/CRITICAL findings with `evidence: inferential` to one `refuter` call as a single batch
   (id, location, severity, claim, proof), plus the context file path and whether the worktree is at `HEAD`.
   Deterministic findings (reproduced by the `verifier` or by you) skip it.
   Findings scoring below 80 are dropped, not softened.
7. **Report.** Surviving findings first, by severity; then dropped ones with the refuter's reason; then lenses that came back incomplete.

## Reference

`reference/gentle-originals/` holds the original Gentle AI `review-*.md` agents verbatim (risk, resilience, readability, reliability, refuter). The lenses and `contract.md` are distilled from them; consult the originals when a criterion is unclear.

## Rules

- Do not fix anything inside this skill. Fixing is a separate step the user triggers.
- A reviewer that returns incomplete is reported as incomplete, never silently retried more than once.
- Pre-existing findings go in a follow-ups list; they never block.
