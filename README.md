# pi-fable

> Fable-style disciplined workflow for [pi](https://pi.dev) — goal ledger, findings gate, evidence-based verification.

Adapted from [FableCodex](https://github.com/baskduf/FableCodex) for the pi coding agent.

## What it does

pi-fable enforces a structured, evidence-based workflow when you're tackling multi-step, risky, or review-sensitive tasks. It adds:

- **Goal ledger** — break tasks into trackable goals with evidence checkpoints
- **Findings gate** — track review issues and block completion until they're resolved
- **Verification enforcement** — final goals require proof (tests, lint, screenshots, etc.)
- **State persistence** — workflow state survives across turns in `.fablecodex/`

## Installation

### npm (recommended)

```bash
pi install npm:pi-fable
```

### Git

```bash
pi install git:github.com/user/pi-fable
```

### Local

```bash
pi install /path/to/pi-fable
```

### Quick test

```bash
pi -e ./extensions/fable.ts
```

## Usage

### Start a workflow

Type `/fable` followed by a description of your task:

```
/fable Add CSV import to the data pipeline
```

This auto-creates a 3-goal starter plan:

```
G001 [active] inspect
  Objective: Explore the workspace, understand current state...
G002 [pending] implement
  Objective: Make the necessary changes to complete...
G003 [pending] verify
  Objective: Run tests, lint, typecheck... Provide verification command and output as evidence.
```

G001 activates immediately — the agent starts inspecting your workspace.

### Manual goal management

Use the `fable_goals` tool for full control:

```
fable_goals action=create brief="Add CSV import" goals=[
  { title: "inspect", objective: "Find current import flow and tests" },
  { title: "implement", objective: "Add CSV parser and UI path" },
  { title: "verify", objective: "Run tests and a sample import" }
]
```

Advance to the next goal:
```
fable_goals action=next
```

Complete a goal with evidence:
```
fable_goals action=checkpoint goalId=G001 status=complete evidence="Read importer.ts and import.test.ts"
```

Final goal requires verification:
```
fable_goals action=checkpoint goalId=G003 status=complete evidence="Ran full test suite" verifyCmd="npm test" verifyEvidence="all tests passed"
```

Check progress:
```
fable_goals action=status
```

### Track findings

Use the `fable_findings` tool to track issues found during work:

```
fable_findings action=add title="Missing error handling for empty CSV" severity=high evidence="importer.ts doesn't handle empty files"
```

Review open findings:
```
fable_findings action=next
```

Resolve a finding with verification:
```
fable_findings action=resolve findingId=F001 evidence="Added empty file check in importer.ts" verifyEvidence="import empty.csv returns graceful error"
```

Run the findings gate (blocks final goal if issues remain):
```
fable_findings action=gate
```

### Reset

Clear all state and start fresh:
```
fable_reset
```

## How it works

### Command

| Command | Description |
|---------|-------------|
| `/fable [brief]` | Activate workflow and auto-create a starter plan |

### Tools

| Tool | Description |
|------|-------------|
| `fable_goals` | Create, advance, checkpoint, and status-check the goal ledger |
| `fable_findings` | Add, list, advance, resolve, reject, gate-check, and status-check findings |
| `fable_reset` | Clear all workflow state |

### Workflow loop

```
/fable <task>
    │
    ▼
┌─────────────┐
│   Inspect   │ ← Explore workspace, understand current state
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Implement  │ ← Make changes, track findings
└──────┬──────┘
       │
       ▼
┌─────────────┐
│   Verify    │ ← Run tests, lint, typecheck → provide evidence
└──────┬──────┘
       │
       ▼
┌─────────────┐
│ Findings    │ ← Gate: no blocking findings allowed
│ Gate        │
└──────┬──────┘
       │
       ▼
     Done
```

### State storage

All workflow state is stored in `.fablecodex/` in your project root:

| File | Purpose |
|------|---------|
| `goals.json` | Current goal plan and progress |
| `findings.json` | Review findings ledger |
| `ledger.jsonl` | Append-only event history |

Do not commit `.fablecodex/` unless you explicitly want to.

## Features

- **Auto-create starter plans** — `/fable <brief>` generates inspect → implement → verify goals
- **Evidence-based checkpoints** — every goal completion requires concrete evidence
- **Findings gate** — final goal cannot complete while blocking findings remain
- **Severity-sorted findings** — critical issues surface first
- **State persistence** — resume workflows across turns
- **Status bar** — footer shows active Fable workflow
- **System prompt injection** — agent receives Fable workflow instructions when active

## License

AGPL-3.0-or-later — same as [FableCodex](https://github.com/baskduf/FableCodex).
