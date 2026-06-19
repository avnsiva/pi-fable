import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

// ── Constants ─────────────────────────────────────────────────────────────

export const STATE_DIR = ".fablecodex";
export const GOALS_FILE = "goals.json";
export const FINDINGS_FILE = "findings.json";
export const LEDGER_FILE = "ledger.jsonl";

// ── Types ─────────────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  title: string;
  objective: string;
  status: "pending" | "in_progress" | "complete" | "failed" | "blocked";
  evidence: string;
  verify_cmd: string;
  verify_evidence: string;
}

export interface GoalPlan {
  brief: string;
  created: string;
  goals: Goal[];
}

export interface Finding {
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

export interface FindingsLedger {
  created: string;
  updated?: string;
  findings: Finding[];
}

// ── State helpers ─────────────────────────────────────────────────────────

export function stateDir(cwd: string): string {
  return join(cwd, STATE_DIR);
}

export function ensureStateDir(cwd: string): void {
  const dir = stateDir(cwd);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function readJson<T>(cwd: string, file: string): T | null {
  const path = join(stateDir(cwd), file);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return null;
  }
}

export function writeJson(cwd: string, file: string, data: unknown): void {
  ensureStateDir(cwd);
  const path = join(stateDir(cwd), file);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

export function appendLedger(cwd: string, event: string, fields: Record<string, unknown>): void {
  ensureStateDir(cwd);
  const path = join(stateDir(cwd), LEDGER_FILE);
  const record = { ts: new Date().toISOString(), event, ...fields };
  const line = JSON.stringify(record) + "\n";
  appendFileSync(path, line, "utf-8");
}

export function now(): string {
  return new Date().toISOString();
}

export function nextFindingId(findings: Finding[]): string {
  let max = 0;
  for (const f of findings) {
    const m = f.id.match(/^F(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `F${String(max + 1).padStart(3, "0")}`;
}

export function isFableActive(cwd: string): boolean {
  const plan = readJson<GoalPlan>(cwd, GOALS_FILE);
  if (!plan) return false;
  return plan.goals.some((g) => g.status === "pending" || g.status === "in_progress" || g.status === "failed" || g.status === "blocked");
}

// ── Plan helpers ──────────────────────────────────────────────────────────

export function createGoalPlan(brief: string, goalDefs: Array<{ title: string; objective: string }>): GoalPlan {
  return {
    brief,
    created: now(),
    goals: goalDefs.map((g, i) => ({
      id: `G${String(i + 1).padStart(3, "0")}`,
      title: g.title,
      objective: g.objective,
      status: "pending" as const,
      evidence: "",
      verify_cmd: "",
      verify_evidence: "",
    })),
  };
}

export function createStarterPlan(brief: string): GoalPlan {
  return createGoalPlan(brief, [
    {
      title: "inspect",
      objective: `Explore the workspace, understand current state, and identify what needs to change for: ${brief}`,
    },
    {
      title: "implement",
      objective: `Make the necessary changes to complete: ${brief}`,
    },
    {
      title: "verify",
      objective: `Run tests, lint, typecheck, or other verification to confirm the work is correct and complete. Provide verification command and output as evidence.`,
    },
  ]);
}

export function advanceGoal(plan: GoalPlan): Goal | null {
  const active = plan.goals.filter((g) => g.status === "in_progress");
  if (active.length > 0) return active[0];

  const pending = plan.goals.filter((g) => g.status === "pending");
  if (pending.length === 0) {
    const incomplete = plan.goals.filter((g) => g.status === "failed" || g.status === "blocked");
    if (incomplete.length > 0) {
      incomplete[0].status = "in_progress";
      return incomplete[0];
    }
    return null;
  }

  pending[0].status = "in_progress";
  return pending[0];
}

export function checkpointGoal(
  plan: GoalPlan,
  goalId: string,
  status: "complete" | "failed" | "blocked",
  evidence: string,
  verifyCmd?: string,
  verifyEvidence?: string,
): { success: boolean; error?: string } {
  const VALID_STATUSES = ["complete", "failed", "blocked"];
  if (!goalId || !status) {
    return { success: false, error: "goalId and status are required." };
  }
  if (!VALID_STATUSES.includes(status)) {
    return { success: false, error: `Invalid status "${status}". Valid: ${VALID_STATUSES.join(", ")}.` };
  }

  const goal = plan.goals.find((g) => g.id === goalId);
  if (!goal) {
    return { success: false, error: `Unknown goal ID: ${goalId}.` };
  }
  if (goal.status !== "in_progress") {
    return { success: false, error: `${goalId} is ${goal.status}; activate it with 'next' first.` };
  }

  if (status === "complete") {
    if (!evidence) {
      return { success: false, error: "Complete checkpoints require evidence." };
    }
    const isFinal = goal.id === plan.goals[plan.goals.length - 1].id;
    if (isFinal && (!verifyCmd || !verifyEvidence)) {
      return { success: false, error: "Final goal requires verifyCmd and verifyEvidence." };
    }
  }

  goal.status = status;
  goal.evidence = evidence || "";
  goal.verify_cmd = verifyCmd || "";
  goal.verify_evidence = verifyEvidence || "";
  return { success: true };
}

// ── Findings helpers ──────────────────────────────────────────────────────

export function loadFindings(cwd: string): FindingsLedger {
  const data = readJson<FindingsLedger>(cwd, FINDINGS_FILE);
  if (data) return data;
  return { created: now(), findings: [] };
}

export function saveFindings(cwd: string, data: FindingsLedger): void {
  data.updated = now();
  writeJson(cwd, FINDINGS_FILE, data);
}

export function activeGoalId(cwd: string): string {
  const plan = readJson<GoalPlan>(cwd, GOALS_FILE);
  if (!plan) return "";
  const active = plan.goals.filter((g) => g.status === "in_progress");
  return active.length === 1 ? active[0].id : "";
}

export function addFinding(
  data: FindingsLedger,
  params: {
    title: string;
    evidence: string;
    severity?: string;
    source?: string;
    goal?: string;
    location?: string;
  },
): Finding {
  const id = nextFindingId(data.findings);
  const finding: Finding = {
    id,
    goal: params.goal || "",
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
  return finding;
}

export function resolveFinding(
  data: FindingsLedger,
  findingId: string,
  evidence: string,
  verifyEvidence: string,
  verifyCmd?: string,
): { success: boolean; error?: string } {
  if (!findingId || !evidence || !verifyEvidence) {
    return { success: false, error: "findingId, evidence, and verifyEvidence are required." };
  }
  const finding = data.findings.find((f) => f.id === findingId);
  if (!finding) {
    return { success: false, error: `Unknown finding: ${findingId}.` };
  }
  if (finding.status !== "open" && finding.status !== "blocked") {
    return { success: false, error: `${findingId} is ${finding.status}; reopen it first.` };
  }
  finding.status = "resolved";
  finding.resolution = evidence;
  finding.verify_evidence = verifyEvidence;
  finding.verify_cmd = verifyCmd || "";
  finding.updated = now();
  return { success: true };
}

export function rejectFinding(
  data: FindingsLedger,
  findingId: string,
  reason: string,
): { success: boolean; error?: string } {
  if (!findingId || !reason) {
    return { success: false, error: "findingId and reason are required." };
  }
  const finding = data.findings.find((f) => f.id === findingId);
  if (!finding) {
    return { success: false, error: `Unknown finding: ${findingId}.` };
  }
  if (finding.status === "resolved" || finding.status === "rejected") {
    return { success: false, error: `${findingId} is already ${finding.status}.` };
  }
  finding.status = "rejected";
  finding.resolution = reason;
  finding.updated = now();
  return { success: true };
}

export function checkFindingsGate(data: FindingsLedger): { passed: boolean; blockers: Finding[] } {
  const blockers = data.findings.filter(
    (f) => f.status === "open" || f.status === "blocked",
  );
  return { passed: blockers.length === 0, blockers };
}

export function sortFindings(findings: Finding[]): Finding[] {
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...findings].sort(
    (a, b) =>
      (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99) ||
      a.id.localeCompare(b.id),
  );
}

export function formatFinding(f: Finding): string {
  const goal = f.goal ? ` goal=${f.goal}` : "";
  const location = f.location ? ` location=${f.location}` : "";
  return `${f.id} [${f.status}] ${f.severity} ${f.title}${goal}${location}`;
}
