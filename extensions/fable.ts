import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// ── State helpers ──────────────────────────────────────────────────────────

const STATE_DIR = ".fablecodex";
const GOALS_FILE = "goals.json";
const FINDINGS_FILE = "findings.json";
const LEDGER_FILE = "ledger.jsonl";

interface Goal {
  id: string;
  title: string;
  objective: string;
  status: "pending" | "in_progress" | "complete" | "failed" | "blocked";
  evidence: string;
  verify_cmd: string;
  verify_evidence: string;
}

interface GoalPlan {
  brief: string;
  created: string;
  goals: Goal[];
}

interface Finding {
  id: string;
  goal: string;
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  source: string;
  status: "open" | "blocked" | "resolved" | "rejected";
  location: string;
  evidence: string;
  resolution: string;
  verify_cmd: string;
  verify_evidence: string;
  created: string;
  updated: string;
}

interface FindingsLedger {
  created: string;
  updated?: string;
  findings: Finding[];
}

function stateDir(cwd: string): string {
  return join(cwd, STATE_DIR);
}

function ensureStateDir(cwd: string): void {
  const dir = stateDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readJson<T>(cwd: string, file: string): T | null {
  const path = join(stateDir(cwd), file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

function writeJson(cwd: string, file: string, data: unknown): void {
  ensureStateDir(cwd);
  const path = join(stateDir(cwd), file);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function appendLedger(cwd: string, event: string, fields: Record<string, unknown>): void {
  ensureStateDir(cwd);
  const path = join(stateDir(cwd), LEDGER_FILE);
  const record = { ts: new Date().toISOString(), event, ...fields };
  const line = JSON.stringify(record) + "\n";
  appendFileSync(path, line, "utf-8");
}

function now(): string {
  return new Date().toISOString();
}

function nextFindingId(findings: Finding[]): string {
  let max = 0;
  for (const f of findings) {
    const m = f.id.match(/^F(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `F${String(max + 1).padStart(3, "0")}`;
}

// ── Active fable mode detection ──────────────────────────────────────────

function isFableActive(cwd: string): boolean {
  const plan = readJson<GoalPlan>(cwd, GOALS_FILE);
  if (!plan) return false;
  return plan.goals.some((g) => g.status === "pending" || g.status === "in_progress" || g.status === "failed" || g.status === "blocked");
}

// ── Extension entry ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── /fable command ─────────────────────────────────────────────────────
  pi.registerCommand("fable", {
    description:
      "Activate the Fable-style disciplined workflow — goal ledger, findings gate, evidence-based verification. Usage: /fable [brief description of the task]",
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const brief = args?.trim() || "Unnamed task";

      ensureStateDir(cwd);

      // Check for existing plan
      const existing = readJson<GoalPlan>(cwd, GOALS_FILE);
      if (existing && existing.goals.some((g) => g.status !== "complete")) {
        ctx.ui.notify(
          `Fable workflow already active (${existing.brief}). Use /fable status to check progress, or /fable reset to start fresh.`,
          "warn",
        );
        return;
      }

      // Auto-create a starter plan with inspect → implement → verify
      const goals: Goal[] = [
        {
          id: "G001",
          title: "inspect",
          objective: `Explore the workspace, understand current state, and identify what needs to change for: ${brief}`,
          status: "in_progress",
          evidence: "",
          verify_cmd: "",
          verify_evidence: "",
        },
        {
          id: "G002",
          title: "implement",
          objective: `Make the necessary changes to complete: ${brief}`,
          status: "pending",
          evidence: "",
          verify_cmd: "",
          verify_evidence: "",
        },
        {
          id: "G003",
          title: "verify",
          objective: `Run tests, lint, typecheck, or other verification to confirm the work is correct and complete. Provide verification command and output as evidence.`,
          status: "pending",
          evidence: "",
          verify_cmd: "",
          verify_evidence: "",
        },
      ];

      const plan: GoalPlan = {
        brief,
        created: now(),
        goals,
      };

      writeJson(cwd, GOALS_FILE, plan);
      appendLedger(cwd, "plan_created", { brief, count: goals.length });

      ctx.ui.setStatus("fable", `fable: ${brief}`);
      ctx.ui.notify(`Fable workflow started: "${brief}"`, "info");
    },
  });

  // ── Event: inject Fable instructions when active ───────────────────────
  pi.on("before_agent_start", async (event, ctx) => {
    if (!isFableActive(ctx.cwd)) return;

    const cwd = ctx.cwd;
    const plan = readJson<GoalPlan>(cwd, GOALS_FILE);

    const instructions = `
# Fable Workflow Active

You are operating under the Fable disciplined workflow. Follow these rules strictly:

## Core Loop
1. **Classify and route** — keep simple answers in the normal loop; use the Fable workflow for multi-step, risky, or review-sensitive work.
2. **Inspect before acting** — search workspace/files before taking action.
3. **Plan when it changes execution** — for 2+ dependent stories, create a goal ledger.
4. **Work through real tools** — read, search, implement, verify.
5. **Track findings** — when misses are costly, add findings and resolve them with evidence.
6. **Verify and close** — prefer tests, lint, typecheck, or command output over memory.

## Goal Management
- Create goals with \`fable_goals\` tool
- Checkpoint goals with evidence when complete
- The final goal requires verification command and evidence
- All blocking findings must be resolved before the final goal completes

## Findings Gate
- Track review findings, bugs, edge cases with \`fable_findings\` tool
- Resolve findings only with resolution evidence and verification evidence
- Run findings gate before final completion

## Current State
${plan ? `Active plan: "${plan.brief}" (${plan.goals.filter((g) => g.status === "complete").length}/${plan.goals.length} complete)` : "No active plan. Create one with the fable_goals tool."}

Respond with outcome first, then changed files, verification evidence, and residual risk.`;

    return {
      systemPrompt: event.systemPrompt + "\n\n" + instructions,
    };
  });

  // ── Tool: fable_goals ──────────────────────────────────────────────────
  pi.registerTool({
    name: "fable_goals",
    label: "Fable Goals",
    description:
      "Manage the Fable goal ledger. Actions: create (with brief and goals), next (advance to next goal), checkpoint (mark goal with evidence), status (show progress).",
    parameters: Type.Object({
      action: Type.String({
        description:
          'The action to perform: "create", "next", "checkpoint", or "status"',
      }),
      brief: Type.Optional(
        Type.String({ description: "Task brief (required for create)" }),
      ),
      goals: Type.Optional(
        Type.Array(
          Type.Object({
            title: Type.String(),
            objective: Type.String(),
          }),
          { description: "Goals in title::objective format (required for create)" },
        ),
      ),
      goalId: Type.Optional(
        Type.String({ description: "Goal ID like G001 (required for checkpoint)" }),
      ),
      status: Type.Optional(
        Type.String({
          description:
            'Goal status for checkpoint: "complete", "failed", or "blocked"',
        }),
      ),
      evidence: Type.Optional(
        Type.String({ description: "Evidence of completion (required for checkpoint)" }),
      ),
      verifyCmd: Type.Optional(
        Type.String({ description: "Verification command (required for final goal)" }),
      ),
      verifyEvidence: Type.Optional(
        Type.String({
          description: "Verification output (required for final goal)",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const { action } = params;

      if (action === "create") {
        if (!params.brief || !params.goals || params.goals.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Error: brief and at least one goal are required for create.",
              },
            ],
            details: {},
          };
        }

        const goals: Goal[] = params.goals.map((g, i) => ({
          id: `G${String(i + 1).padStart(3, "0")}`,
          title: g.title,
          objective: g.objective,
          status: "pending" as const,
          evidence: "",
          verify_cmd: "",
          verify_evidence: "",
        }));

        const plan: GoalPlan = {
          brief: params.brief,
          created: now(),
          goals,
        };

        writeJson(cwd, GOALS_FILE, plan);
        appendLedger(cwd, "plan_created", {
          brief: params.brief,
          count: goals.length,
        });

        ctx.ui.setStatus("fable", `fable: ${params.brief}`);

        const lines = [
          `Plan created with ${goals.length} goals:`,
          ...goals.map((g) => `  ${g.id} ${g.title}: ${g.objective}`),
          "",
          "Use fable_goals with action='next' to start the first goal.",
        ];

        return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
      }

      if (action === "status") {
        const plan = readJson<GoalPlan>(cwd, GOALS_FILE);
        if (!plan) {
          return {
            content: [{ type: "text", text: "No active goal plan. Create one first." }],
            details: {},
          };
        }

        const done = plan.goals.filter((g) => g.status === "complete").length;
        const markers: Record<string, string> = {
          complete: "done",
          in_progress: "active",
          pending: "pending",
          failed: "failed",
          blocked: "blocked",
        };

        const lines = [
          `${done}/${plan.goals.length} complete — ${plan.brief}`,
          ...plan.goals.map(
            (g) =>
              `  ${g.id} [${markers[g.status] || g.status}] ${g.title}` +
              (g.evidence ? `\n    evidence: ${g.evidence}` : ""),
          ),
        ];

        // Also show findings status
        const findings = readJson<FindingsLedger>(cwd, FINDINGS_FILE);
        if (findings && findings.findings.length > 0) {
          const counts = {
            open: findings.findings.filter((f) => f.status === "open").length,
            blocked: findings.findings.filter((f) => f.status === "blocked").length,
            resolved: findings.findings.filter((f) => f.status === "resolved").length,
            rejected: findings.findings.filter((f) => f.status === "rejected").length,
          };
          const summary = Object.entries(counts)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${v} ${k}`)
            .join(", ");
          lines.push("", `Findings: ${summary}`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
      }

      if (action === "next") {
        const plan = readJson<GoalPlan>(cwd, GOALS_FILE);
        if (!plan) {
          return {
            content: [{ type: "text", text: "No active goal plan. Create one first." }],
            details: {},
          };
        }

        // Find active goal
        const active = plan.goals.filter((g) => g.status === "in_progress");
        if (active.length > 0) {
          const goal = active[0];
          return {
            content: [
              {
                type: "text",
                text: [
                  `Active goal: ${goal.id} ${goal.title}`,
                  `Objective: ${goal.objective}`,
                  "Work this goal only and produce concrete evidence.",
                  `On completion: fable_goals action=checkpoint goalId=${goal.id} status=complete evidence="<evidence>"`,
                ].join("\n"),
              },
            ],
            details: {},
          };
        }

        // Find next pending
        const pending = plan.goals.filter((g) => g.status === "pending");
        if (pending.length === 0) {
          // Check for incomplete terminal goals
          const incomplete = plan.goals.filter(
            (g) => g.status === "failed" || g.status === "blocked",
          );
          if (incomplete.length > 0) {
            const goal = incomplete[0];
            goal.status = "in_progress";
            writeJson(cwd, GOALS_FILE, plan);
            appendLedger(cwd, "story_reopened", {
              id: goal.id,
              title: goal.title,
              previous_status: "failed",
            });
            return {
              content: [
                {
                  type: "text",
                  text: `Reopened ${goal.id} from failed.\nObjective: ${goal.objective}`,
                },
              ],
              details: {},
            };
          }
          return {
            content: [{ type: "text", text: "All goals complete!" }],
            details: {},
          };
        }

        const goal = pending[0];
        goal.status = "in_progress";
        writeJson(cwd, GOALS_FILE, plan);
        appendLedger(cwd, "story_started", { id: goal.id, title: goal.title });

        const isFinal = goal.id === plan.goals[plan.goals.length - 1].id;
        const lines = [
          `=== Fable handoff: ${goal.id} ${goal.title}`,
          `Objective: ${goal.objective}`,
          "Rule: work this goal only and produce concrete evidence.",
          `On completion: fable_goals action=checkpoint goalId=${goal.id} status=complete evidence="<evidence>"`,
        ];
        if (isFinal) {
          lines.push(
            "Final goal: completion requires verifyCmd and verifyEvidence.",
            `On completion: fable_goals action=checkpoint goalId=${goal.id} status=complete evidence="<evidence>" verifyCmd="<command>" verifyEvidence="<result>"`,
          );
        }

        return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
      }

      if (action === "checkpoint") {
        const VALID_STATUSES = ["complete", "failed", "blocked"];
        if (!params.goalId || !params.status) {
          return {
            content: [
              {
                type: "text",
                text: "Error: goalId and status are required for checkpoint.",
              },
            ],
            details: {},
          };
        }
        if (!VALID_STATUSES.includes(params.status)) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid status "${params.status}". Valid: ${VALID_STATUSES.join(", ")}.`,
              },
            ],
            details: {},
          };
        }

        const plan = readJson<GoalPlan>(cwd, GOALS_FILE);
        if (!plan) {
          return {
            content: [{ type: "text", text: "No active goal plan." }],
            details: {},
          };
        }

        const goal = plan.goals.find((g) => g.id === params.goalId);
        if (!goal) {
          return {
            content: [
              { type: "text", text: `Unknown goal ID: ${params.goalId}` },
            ],
            details: {},
          };
        }

        if (goal.status !== "in_progress") {
          return {
            content: [
              {
                type: "text",
                text: `${params.goalId} is ${goal.status}; activate it with action='next' first.`,
              },
            ],
            details: {},
          };
        }

        if (params.status === "complete") {
          if (!params.evidence) {
            return {
              content: [
                {
                  type: "text",
                  text: "Complete checkpoints require evidence.",
                },
              ],
              details: {},
            };
          }

          // Final goal requires verification
          const isFinal = goal.id === plan.goals[plan.goals.length - 1].id;
          if (isFinal && (!params.verifyCmd || !params.verifyEvidence)) {
            return {
              content: [
                {
                  type: "text",
                  text: "Final goal requires verifyCmd and verifyEvidence.",
                },
              ],
              details: {},
            };
          }

          // Final goal also requires findings gate
          if (isFinal) {
            const findings = readJson<FindingsLedger>(cwd, FINDINGS_FILE);
            if (findings) {
              const blockers = findings.findings.filter(
                (f) => f.status === "open" || f.status === "blocked",
              );
              if (blockers.length > 0) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Final goal requires findings gate; ${blockers.length} blocking findings remain (${blockers.map((f) => f.id).join(", ")}).`,
                    },
                  ],
                  details: {},
                };
              }
            }
          }
        }

        goal.status = params.status as Goal["status"];
        goal.evidence = params.evidence || "";
        goal.verify_cmd = params.verifyCmd || "";
        goal.verify_evidence = params.verifyEvidence || "";
        writeJson(cwd, GOALS_FILE, plan);
        appendLedger(cwd, "checkpoint", {
          id: goal.id,
          status: params.status,
          evidence: params.evidence,
        });

        const remaining = plan.goals.filter(
          (g) => g.status === "pending" || g.status === "in_progress",
        );
        const lines = [`${goal.id} -> ${params.status}`];
        if (remaining.length > 0) {
          lines.push(`${remaining.length} goals left`);
        } else {
          lines.push("All goals complete!");
          ctx.ui.setStatus("fable", "");
        }

        return { content: [{ type: "text", text: lines.join("\n") }], details: {} };
      }

      return {
        content: [
          {
            type: "text",
            text: `Unknown action: ${action}. Valid actions: create, next, checkpoint, status.`,
          },
        ],
        details: {},
      };
    },
  });

  // ── Tool: fable_findings ───────────────────────────────────────────────
  pi.registerTool({
    name: "fable_findings",
    label: "Fable Findings",
    description:
      "Manage the Fable findings ledger. Actions: add, list, next, resolve, reject, gate, status. Tracks review findings that must be resolved before completion.",
    parameters: Type.Object({
      action: Type.String({
        description:
          'Action: "add", "list", "next", "resolve", "reject", "gate", or "status"',
      }),
      findingId: Type.Optional(
        Type.String({ description: "Finding ID like F001 (for resolve/reject)" }),
      ),
      title: Type.Optional(
        Type.String({ description: "Finding title (required for add)" }),
      ),
      evidence: Type.Optional(
        Type.String({ description: "Finding evidence (required for add/resolve)" }),
      ),
      severity: Type.Optional(
        Type.String({
          description: 'Severity: "low", "medium", "high", or "critical" (default: medium)',
        }),
      ),
      source: Type.Optional(
        Type.String({
          description:
            'Source: "main", "subagent", "test", "user", "review", or "command" (default: main)',
        }),
      ),
      goal: Type.Optional(
        Type.String({ description: "Associated goal ID (auto-detected from active goal if omitted)" }),
      ),
      location: Type.Optional(
        Type.String({ description: "File or code location" }),
      ),
      verifyEvidence: Type.Optional(
        Type.String({ description: "Verification evidence (required for resolve)" }),
      ),
      reason: Type.Optional(
        Type.String({ description: "Rejection reason (required for reject)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const { action } = params;

      function loadFindings(): FindingsLedger {
        const data = readJson<FindingsLedger>(cwd, FINDINGS_FILE);
        if (data) return data;
        return { created: now(), findings: [] };
      }

      function saveFindings(data: FindingsLedger): void {
        data.updated = now();
        writeJson(cwd, FINDINGS_FILE, data);
      }

      function activeGoalId(): string {
        const plan = readJson<GoalPlan>(cwd, GOALS_FILE);
        if (!plan) return "";
        const active = plan.goals.filter((g) => g.status === "in_progress");
        return active.length === 1 ? active[0].id : "";
      }

      function formatFinding(f: Finding): string {
        const goal = f.goal ? ` goal=${f.goal}` : "";
        const location = f.location ? ` location=${f.location}` : "";
        return `${f.id} [${f.status}] ${f.severity} ${f.title}${goal}${location}`;
      }

      if (action === "add") {
        if (!params.title || !params.evidence) {
          return {
            content: [
              {
                type: "text",
                text: "Error: title and evidence are required for add.",
              },
            ],
            details: {},
          };
        }

        const data = loadFindings();
        const id = nextFindingId(data.findings);
        const goal = params.goal || activeGoalId();

        const finding: Finding = {
          id,
          goal,
          title: params.title,
          severity: (params.severity as Finding["severity"]) || "medium",
          source: params.source || "main",
          status: "open",
          location: params.location || "",
          evidence: params.evidence,
          resolution: "",
          verify_cmd: "",
          verify_evidence: "",
          created: now(),
          updated: "",
        };

        data.findings.push(finding);
        saveFindings(data);
        appendLedger(cwd, "finding_added", {
          id,
          goal,
          severity: finding.severity,
          title: finding.title,
        });

        return {
          content: [{ type: "text", text: `Added ${id}\n${formatFinding(finding)}` }],
          details: {},
        };
      }

      if (action === "list") {
        const data = loadFindings();
        if (data.findings.length === 0) {
          return {
            content: [{ type: "text", text: "No findings." }],
            details: {},
          };
        }

        const severityOrder: Record<string, number> = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
        };
        const sorted = [...data.findings].sort(
          (a, b) =>
            (severityOrder[a.severity] ?? 99) -
              (severityOrder[b.severity] ?? 99) ||
            a.id.localeCompare(b.id),
        );

        const lines = sorted.map(formatFinding);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {},
        };
      }

      if (action === "next") {
        const data = loadFindings();
        const open = data.findings.filter((f) => f.status === "open");
        if (open.length === 0) {
          return {
            content: [{ type: "text", text: "No open findings." }],
            details: {},
          };
        }

        const severityOrder: Record<string, number> = {
          critical: 0,
          high: 1,
          medium: 2,
          low: 3,
        };
        const sorted = open.sort(
          (a, b) =>
            (severityOrder[a.severity] ?? 99) -
              (severityOrder[b.severity] ?? 99) ||
            a.id.localeCompare(b.id),
        );

        const finding = sorted[0];
        const lines = [
          `=== Fable finding: ${finding.id} ${finding.title}`,
          `Severity: ${finding.severity}`,
          finding.goal ? `Goal: ${finding.goal}` : "",
          finding.location ? `Location: ${finding.location}` : "",
          `Evidence: ${finding.evidence}`,
          `On resolution: fable_findings action=resolve findingId=${finding.id} evidence="<what changed>" verifyEvidence="<verification>"`,
        ].filter(Boolean);

        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: {},
        };
      }

      if (action === "resolve") {
        if (!params.findingId || !params.evidence || !params.verifyEvidence) {
          return {
            content: [
              {
                type: "text",
                text: "Error: findingId, evidence, and verifyEvidence are required for resolve.",
              },
            ],
            details: {},
          };
        }

        const data = loadFindings();
        const finding = data.findings.find((f) => f.id === params.findingId);
        if (!finding) {
          return {
            content: [
              { type: "text", text: `Unknown finding: ${params.findingId}` },
            ],
            details: {},
          };
        }

        if (finding.status !== "open" && finding.status !== "blocked") {
          return {
            content: [
              {
                type: "text",
                text: `${params.findingId} is ${finding.status}; reopen it first.`,
              },
            ],
            details: {},
          };
        }

        finding.status = "resolved";
        finding.resolution = params.evidence;
        finding.verify_evidence = params.verifyEvidence;
        finding.updated = now();
        saveFindings(data);
        appendLedger(cwd, "finding_resolved", { id: params.findingId });

        return {
          content: [
            { type: "text", text: `${params.findingId} -> resolved` },
          ],
          details: {},
        };
      }

      if (action === "reject") {
        if (!params.findingId || !params.reason) {
          return {
            content: [
              {
                type: "text",
                text: "Error: findingId and reason are required for reject.",
              },
            ],
            details: {},
          };
        }

        const data = loadFindings();
        const finding = data.findings.find((f) => f.id === params.findingId);
        if (!finding) {
          return {
            content: [
              { type: "text", text: `Unknown finding: ${params.findingId}` },
            ],
            details: {},
          };
        }

        if (finding.status === "resolved" || finding.status === "rejected") {
          return {
            content: [
              {
                type: "text",
                text: `${params.findingId} is already ${finding.status}.`,
              },
            ],
            details: {},
          };
        }

        finding.status = "rejected";
        finding.resolution = params.reason;
        finding.updated = now();
        saveFindings(data);
        appendLedger(cwd, "finding_rejected", { id: params.findingId });

        return {
          content: [
            { type: "text", text: `${params.findingId} -> rejected` },
          ],
          details: {},
        };
      }

      if (action === "gate") {
        const data = loadFindings();
        const blockers = data.findings.filter(
          (f) => f.status === "open" || f.status === "blocked",
        );

        if (blockers.length > 0) {
          const lines = [
            `Findings gate failed; ${blockers.length} blocking findings remain`,
            ...blockers.map((f) => `  ${formatFinding(f)}`),
          ];
          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: {},
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: "Findings gate passed." }],
          details: {},
        };
      }

      if (action === "status") {
        const data = loadFindings();
        const counts = {
          open: data.findings.filter((f) => f.status === "open").length,
          blocked: data.findings.filter((f) => f.status === "blocked").length,
          resolved: data.findings.filter((f) => f.status === "resolved").length,
          rejected: data.findings.filter((f) => f.status === "rejected").length,
        };

        const summary = Object.entries(counts)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ");

        return {
          content: [
            {
              type: "text",
              text: summary || "0 findings",
            },
          ],
          details: {},
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Unknown action: ${action}. Valid: add, list, next, resolve, reject, gate, status.`,
          },
        ],
        details: {},
      };
    },
  });

  // ── Tool: fable_reset ──────────────────────────────────────────────────
  pi.registerTool({
    name: "fable_reset",
    label: "Fable Reset",
    description: "Reset the Fable workflow state and start fresh.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const cwd = ctx.cwd;
      const dir = stateDir(cwd);

      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }

      ctx.ui.setStatus("fable", "");

      return {
        content: [
          { type: "text", text: "Fable workflow state cleared. Ready for a fresh start." },
        ],
        details: {},
      };
    },
  });

}
