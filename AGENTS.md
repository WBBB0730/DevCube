# AGENTS.md

## CONTEXT.md

`CONTEXT.md` should be totally devoid of implementation details. Do not treat `CONTEXT.md` as a spec, a scratch pad, or a repository for implementation decisions. It is a glossary and nothing else.

Use its canonical terms, and avoid the listed aliases, wherever a domain concept appears in docs, tests, or implementation. Update it whenever a term is added, renamed, or clarified.

**File structure.** Single context: a root `CONTEXT.md` and `docs/adr/`.

**Format.**

```md
# {Context Name}

{One or two sentence description of what this context is and why it exists.}

## Language

**Order**:
{A one or two sentence description of the term}
_Avoid_: Purchase, transaction
```

**Rules.**

- **Be opinionated.** When multiple words exist for the same concept, pick the best one and list the others as aliases to avoid.
- **Flag conflicts explicitly.** If a term is used ambiguously, call it out in "Flagged ambiguities" with a clear resolution.
- **Keep definitions tight.** One or two sentences max. Define what it IS, not what it does.
- **Show relationships.** Use bold term names and express cardinality where obvious.
- **Only include terms specific to this project's context.** General programming concepts (timeouts, error types, utility patterns) don't belong even if the project uses them extensively. Before adding a term, ask: is this a concept unique to this context, or a general programming concept? Only the former belongs.
- **Group terms under subheadings** when natural clusters emerge. If all terms belong to a single cohesive area, a flat list is fine.
- **Write an example dialogue.** A conversation between a dev and a domain expert that demonstrates how the terms interact naturally and clarifies boundaries between related concepts.

## docs/adr/

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc. Create the directory lazily — only when the first ADR is needed. Scan `docs/adr/` for the highest existing number and increment by one. Read the ADRs touching an area before changing it, and add or update one when a qualifying decision changes.

**Template.**

```md
# {Short title of the decision}

{1-3 sentences: what's the context, what did we decide, and why.}
```

That's it. An ADR can be a single paragraph. The value is in recording _that_ a decision was made and _why_ — not in filling out sections.

**Optional sections.** Only include these when they add genuine value. Most ADRs won't need them.

- **Status** frontmatter (`proposed | accepted | deprecated | superseded by ADR-NNNN`) — useful when decisions are revisited
- **Considered Options** — only when the rejected alternatives are worth remembering
- **Consequences** — only when non-obvious downstream effects need to be called out

**When to offer an ADR.** All three of these must be true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR.

**What qualifies.** Architectural shape; integration patterns between contexts; technology choices that carry lock-in (not every library — just the ones that would take a quarter to swap out); boundary and scope decisions (the explicit no-s are as valuable as the yes-s); deliberate deviations from the obvious path; constraints not visible in the code; and rejected alternatives when the rejection is non-obvious.

## PRD (`docs/prd/<feature-slug>.md`)

One PRD file per feature. Synthesize the PRD from the current conversation and codebase understanding — do NOT interview the user. Use the project's domain glossary vocabulary throughout, and respect any ADRs in the area you're touching. This repo keeps PRDs only: do not create issue or task files, and do not run a triage step, unless the user explicitly asks. Update the PRD when product scope, user flows, implementation decisions, or testing decisions change.

**Template.**

```md
## Problem Statement

The problem that the user is facing, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each one in the format:

1. As a <actor>, I want a <feature>, so that <benefit>

This list should be extensive and cover all aspects of the feature.

## Implementation Decisions

The modules to build/modify and their interfaces, technical clarifications, architectural decisions, schema changes, API contracts, and specific interactions. Do NOT include specific file paths or code snippets — they go outdated quickly. Exception: if a prototype produced a snippet that encodes a decision more precisely than prose can (state machine, reducer, schema, type shape), inline the decision-rich part and note briefly that it came from a prototype.

## Testing Decisions

What makes a good test (only test external behavior, not implementation details), which modules will be tested, and prior art for the tests (similar types of tests in the codebase).

## Out of Scope

The things that are out of scope for this PRD.

## Further Notes

Any further notes about the feature.
```

## DESIGN.md

The current workspace's visual and interaction direction. Read it before changing UI, and update it when those conventions stably change.
