# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

**This repo is single-context.** There is no `CONTEXT-MAP.md` and no per-context `src/<context>/docs/adr/`.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root
- **`docs/adr/`** — read ADRs that touch the area you're about to work in

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

> As of this file being written, neither `CONTEXT.md` nor `docs/adr/` exists yet. That is the expected starting state — do not treat it as a gap to fix.

## File structure

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── site/ api/ scripts/ content/ db/
```

If this repo ever splits into genuinely separate contexts, add a root `CONTEXT-MAP.md` pointing at one `CONTEXT.md` per context, and update this file.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## This repo's own authorities come first

`CLAUDE.md` at the repo root is this project's manual and red lines, and it names two authorities that outrank anything you infer from the code:

- **Layout and information architecture** — the product draft named in `CLAUDE.md` under
  「版面與資訊架構的權威來源 = 產品草案」. Open the draft itself; citing a section number is not
  the same as having read it.
- **Data structures** — `docs/02-data-model.md`.

Also binding: current-state facts (counts, status, which job ran) are never written into docs —
`CLAUDE.md` gives the query for each. Don't bake such numbers into `CONTEXT.md` or an ADR either.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
