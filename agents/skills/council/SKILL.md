---
name: council
description: Trigger this if the user says 'council'. Run a three-provider review panel (Claude, Codex, Pi/other) in a dedicated Herdr tab with blank-slate delegates each round, and iterate until they are satisfied.
---

# Council

Ported from t3dotgg/tstack `skills/council`, adapted to Herdr and to Claude Code, Codex and Pi as orchestrators.

Before an audit, address outstanding PR comments, fix known issues, and run
relevant checks. Give council the updated implementation; do not defer known
fixes until reviews return. If the user wants to discard the implementation
and explore new ideas, skip fixes to code being replaced.

Bring in three delegates to help with the user's request, usually for review
or feedback. Use one strong model from each of three different providers, at
high reasoning effort. If the user's instructions name council members, use
those. Otherwise pick the latest flagship model from each provider, for
example Claude Opus, GPT Sol, and Gemini Pro.

## Blank slate (adversarial reviews)

Every round, every delegate is a **new agent with no memory**. Reusing a
delegate, or telling it about earlier rounds, anchors it and contaminates the
review.

- A new round starts fresh agents. Never `agent prompt` a delegate again.
- The handoff prompt is the same template every round: the request, the scope
  (diff, PR, paths), and the output format. It never mentions round numbers,
  earlier findings, earlier scores, or that fixes were applied.
- The orchestrator alone keeps the ledger: scores per round, findings accepted
  and rejected. It filters findings it already rejected on purpose; it does
  not feed them back to delegates.

## Running the panel in Herdr

Requires `HERDR_ENV=1`. If it is not set, use the headless fallback below.
Run `herdr agent` and `herdr pane` first if a flag below is rejected: the
installed binary is the authority.

Keep the orchestrator's tab clean. Council lives in its own tab; focus never
leaves the orchestrator.

1. **Open the council tab** (once per round):

   ```bash
   herdr tab create --workspace "$HERDR_WORKSPACE_ID" --cwd "$PWD" --label council --no-focus
   ```

   Read `.result.tab.tab_id` and `.result.root_pane.pane_id`. The root pane
   hosts the first delegate.
2. **Add the other two panes** inside that tab, never in the orchestrator's:

   ```bash
   herdr pane split --pane <root-pane-id> --direction right --cwd "$PWD" --no-focus
   herdr pane split --pane <second-pane-id> --direction down --cwd "$PWD" --no-focus
   ```

   Read each new id from `.result.pane.pane_id`.
3. **Start one agent per pane**, read-only, with a unique name and the model
   and effort as native args after `--`:

   ```bash
   herdr agent start c-claude --kind claude --pane <id> -- --model <model> --effort high --disallowedTools "Edit Write NotebookEdit"
   herdr agent start c-codex  --kind codex  --pane <id> -- -m <model> -s read-only -c model_reasoning_effort=high
   herdr agent start c-pi     --kind pi     --pane <id> -- --model <provider>/<model> --thinking high --tools read,grep,find,ls
   ```

   Use `pi --list-models` to see what Pi can reach. If three providers are not
   reachable, or a named member is unavailable, report it instead of
   substituting.
4. **Prompt all three in parallel** (background each call, then wait for all):

   ```bash
   herdr agent prompt c-claude "<handoff>" --wait --timeout 900000
   ```

   The handoff asks for a read-only review and ends with this block, so the
   score can be parsed without guessing:

   ```text
   COUNCIL-RESULT
   SCORE: <0-10>
   FINDINGS: <numbered, most severe first>
   ```
5. **Collect**: `herdr agent read <name> --source recent-unwrapped --lines 300`
   and take what follows the last `COUNCIL-RESULT`. If the response is not
   fully visible, ask the delegate to write it to a file in a `mktemp -d`
   directory and reply only with the path.
6. **If a delegate is `blocked`**, inspect it with `agent get` / `agent read`.
   Do not answer approval dialogs blindly; a read-only reviewer asking to
   write or run something is itself worth noting.
7. **Close the round**: `herdr tab close <tab-id>`. Close only the tab you
   created. The next round repeats from step 1.

## Headless fallback (outside Herdr)

Same blank-slate rules, one fresh process per delegate per round, in parallel:

- Claude: the harness subagent tool (Claude Code: `Agent`), or
  `pi -p --model anthropic/<model> --thinking high` from other harnesses.
- GPT: `codex exec -s read-only -m <model> -c model_reasoning_effort=high "<prompt>"`.
- Third provider: `pi -p --model <provider>/<model> --thinking high --tools read,grep,find,ls "<prompt>"`.

## Scoring and rounds

For a code review, ask each delegate for a score out of 10.
Count each full review pass as one round.
A fresh review after fixes starts a new round, with new agents.

Collect the responses and summarize the useful findings, disagreements, and
recommended next steps.

If the work ends in a pull request, put the results in the PR description.
Put this section before the model and harness line at the end:

```markdown
## Council review

Rounds: 2

| Delegate | Round 1 | Round 2 |
| --- | --- | --- |
| Claude Opus | 7/10 | 9/10 |
| GPT Sol | 8/10 | 10/10 |
| Gemini Pro | 7/10 | 9/10 |
```

If a delegate gives no score, write `no score`. Do not invent one.
If the PR is open, edit the description. Do not post a comment for this.
If there is no PR, put the same results in the final reply only.

If you agree with their recommendations, make the changes and request a fresh
review after. Continue this process until all delegates are satisfied with the
outcome.

Do not let repeated reviews result in scope creep. It is your job to fight to
keep scope limited.
