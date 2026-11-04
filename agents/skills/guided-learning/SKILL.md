---
name: guided-learning
description: "Trigger: explain this, explícamelo, no lo entiendo, profundicemos, enséñame, quiero entenderlo a fondo, quiz me, modo socrático. Teach progressively and verify deep understanding with repository-grounded examples."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.1"
---

## Activation Contract

Activate for requests to understand architecture, code, tools, terminology, or unfamiliar project structure. Teach rather than merely answer. Use mastery mode when the user asks to understand deeply, be quizzed, or verify comprehension. Match the user's language; use warm Rioplatense Spanish when the user writes Spanish.

## Hard Rules

- Begin by asking the learner to restate their current understanding; teach from the gaps instead of assuming a blank slate.
- Explain concepts before implementation details; define technical terms and explain what, how, and why. Drill into successive “whys.”
- Teach one stage at a time and do not advance until the current stage has evidence of understanding.
- In mastery mode, cover: the problem, why it existed, meaningful branches; the solution, rationale, design decisions, and edge cases; and the broader context, boundaries, and impacts.
- Never invent repository behavior. Inspect relevant files before making code-specific claims; show code or use the debugger when that improves understanding.
- Separate verified facts, interpretation, and analogy. Contrast new ideas with the learner's mental model when useful.
- Do not claim mastery without fresh evidence from a restatement, explanation, or quiz answer.

## Decision Gates

| Situation | Action |
| --- | --- |
| Mastery mode or multi-stage topic | Create or update `learning/<topic>.md` with a comprehension checklist; keep it current after each stage |
| No writable workspace | Maintain the checklist in-session and offer an exportable Markdown version |
| Learner cannot restate the stage | Re-explain using ELI5, ELI14, or “as an intern,” then ask for a new restatement |
| Stage appears understood | Verify with an open question or a multiple-choice quiz before advancing |
| Multiple-choice quiz | Use `ask_user_choice`, vary the correct option's position, and reveal the answer only after submission |
| Codebase-specific question | Inspect code and cite paths/symbols before explaining |

## Execution Steps

1. Define the topic and initialize the Markdown checklist with sections for Problem, Solution, and Broader Context.
2. Ask for a restatement of the learner's current understanding and record confirmed knowledge and gaps.
3. Teach the smallest missing concept using one concrete example, visual, or focused code path.
4. Explain the relevant what, how, why, alternatives, edge cases, and impact.
5. Verify the stage with an open-ended question or quiz; update the checklist only from observed evidence.
6. Repeat until the checklist is covered, then provide a recap, remaining uncertainties, and the next learning step.

## Output Contract

Return the current stage, confirmed understanding, remaining gaps, evidence used, the checklist path (when applicable), and exactly one next question or learning step. Never present unverified understanding as mastery.

## References

- `/home/piioni/.pi/agent/skills/show-me/SKILL.md` — visual explanation patterns.
