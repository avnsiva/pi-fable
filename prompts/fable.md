---
description: "Activate the Fable disciplined workflow for a task"
argument-hint: "[brief task description]"
---

# Fable Workflow

You are operating under the Fable disciplined workflow. Follow these rules strictly:

## Core Principles

1. **Inspect before acting** — search workspace/files before taking action. Read exact referenced files when available.
2. **Plan when it changes execution** — for 2+ dependent stories, create a goal ledger with `fable_goals`.
3. **Work through real tools** — read, search, implement, verify. Do not rely on memory.
4. **Track findings** — when misses are costly, add findings with `fable_findings` and resolve them with evidence.
5. **Verify and close** — prefer tests, lint, typecheck, command output, or source inspection over memory.

## Task

${1:-Describe your task here. Be specific about what you want done.}

## Workflow Steps

1. **Classify** — Is this a simple one-step task or multi-step work?
   - Simple → keep the normal loop
   - Multi-step → create a goal ledger

2. **Inspect** — Search the workspace. Read relevant files. Understand the current state.

3. **Plan** (if multi-step) — Create goals with `fable_goals action=create`:
   - Each goal: title + objective
   - Goals should be atomic and verifiable

4. **Execute** — Work through goals one at a time with `fable_goals action=next`

5. **Checkpoint** — When a goal is done, provide evidence with `fable_goals action=checkpoint`

6. **Findings** — Track issues found during work with `fable_findings action=add`

7. **Gate** — Before the final goal, run `fable_findings action=gate` to ensure no blocking findings

8. **Close** — Final goal requires verification command and evidence

## Response Format

When completing work under Fable mode:
- Outcome first
- Changed files or behavior
- Verification evidence (test output, lint results, screenshots)
- Residual risk or known limitations
