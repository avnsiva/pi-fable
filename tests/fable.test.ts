import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createGoalPlan,
  createStarterPlan,
  advanceGoal,
  checkpointGoal,
  addFinding,
  resolveFinding,
  rejectFinding,
  checkFindingsGate,
  sortFindings,
  formatFinding,
  nextFindingId,
  writeJson,
  readJson,
  appendLedger,
  ensureStateDir,
  isFableActive,
  stateDir,
  GOALS_FILE,
  FINDINGS_FILE,
  LEDGER_FILE,
  STATE_DIR,
  type GoalPlan,
  type FindingsLedger,
  type Finding,
} from "../extensions/state";

// ── Helpers ───────────────────────────────────────────────────────────────

const TEST_CWD = join("/tmp", "pi-fable-test-" + Math.random().toString(36).slice(2));

function cleanup(): void {
  const dir = stateDir(TEST_CWD);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Goal Plan", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("creates a plan with correct structure", () => {
    const plan = createGoalPlan("Add CSV import", [
      { title: "inspect", objective: "Find current flow" },
      { title: "implement", objective: "Add parser" },
    ]);

    expect(plan.brief).toBe("Add CSV import");
    expect(plan.goals).toHaveLength(2);
    expect(plan.goals[0].id).toBe("G001");
    expect(plan.goals[0].title).toBe("inspect");
    expect(plan.goals[0].status).toBe("pending");
    expect(plan.goals[1].id).toBe("G002");
  });

  it("creates a starter plan with 3 goals", () => {
    const plan = createStarterPlan("Fix the bug");

    expect(plan.goals).toHaveLength(3);
    expect(plan.goals[0].title).toBe("inspect");
    expect(plan.goals[1].title).toBe("implement");
    expect(plan.goals[2].title).toBe("verify");
  });

  it("advances to next pending goal", () => {
    const plan = createGoalPlan("Test", [
      { title: "a", objective: "a" },
      { title: "b", objective: "b" },
    ]);

    const goal = advanceGoal(plan);
    expect(goal).not.toBeNull();
    expect(goal!.id).toBe("G001");
    expect(goal!.status).toBe("in_progress");
  });

  it("returns active goal if one exists", () => {
    const plan = createGoalPlan("Test", [
      { title: "a", objective: "a" },
      { title: "b", objective: "b" },
    ]);
    plan.goals[0].status = "in_progress";

    const goal = advanceGoal(plan);
    expect(goal!.id).toBe("G001");
  });

  it("returns null when all goals complete", () => {
    const plan = createGoalPlan("Test", [{ title: "a", objective: "a" }]);
    plan.goals[0].status = "complete";

    const goal = advanceGoal(plan);
    expect(goal).toBeNull();
  });

  it("reopens failed goals", () => {
    const plan = createGoalPlan("Test", [{ title: "a", objective: "a" }]);
    plan.goals[0].status = "failed";

    const goal = advanceGoal(plan);
    expect(goal!.id).toBe("G001");
    expect(goal!.status).toBe("in_progress");
  });

  it("checkpoints a goal successfully", () => {
    const plan = createGoalPlan("Test", [{ title: "a", objective: "a" }]);
    plan.goals[0].status = "in_progress";

    const result = checkpointGoal(plan, "G001", "complete", "read files", "npm test", "passed");
    expect(result.success).toBe(true);
    expect(plan.goals[0].status).toBe("complete");
    expect(plan.goals[0].evidence).toBe("read files");
    expect(plan.goals[0].verify_cmd).toBe("npm test");
  });

  it("rejects checkpoint without evidence", () => {
    const plan = createGoalPlan("Test", [{ title: "a", objective: "a" }]);
    plan.goals[0].status = "in_progress";

    const result = checkpointGoal(plan, "G001", "complete", "");
    expect(result.success).toBe(false);
    expect(result.error).toContain("evidence");
  });

  it("rejects checkpoint for non-in_progress goal", () => {
    const plan = createGoalPlan("Test", [{ title: "a", objective: "a" }]);

    const result = checkpointGoal(plan, "G001", "complete", "evidence");
    expect(result.success).toBe(false);
    expect(result.error).toContain("pending");
  });

  it("rejects invalid status", () => {
    const plan = createGoalPlan("Test", [{ title: "a", objective: "a" }]);
    plan.goals[0].status = "in_progress";

    const result = checkpointGoal(plan, "G001", "invalid" as any, "evidence");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid status");
  });

  it("requires verifyCmd for final goal completion", () => {
    const plan = createGoalPlan("Test", [{ title: "a", objective: "a" }]);
    plan.goals[0].status = "in_progress";

    const result = checkpointGoal(plan, "G001", "complete", "evidence");
    expect(result.success).toBe(false);
    expect(result.error).toContain("verifyCmd");
  });

  it("allows final goal completion with verification", () => {
    const plan = createGoalPlan("Test", [{ title: "a", objective: "a" }]);
    plan.goals[0].status = "in_progress";

    const result = checkpointGoal(plan, "G001", "complete", "evidence", "npm test", "passed");
    expect(result.success).toBe(true);
    expect(plan.goals[0].status).toBe("complete");
  });

  it("rejects checkpoint for unknown goal", () => {
    const plan = createGoalPlan("Test", [{ title: "a", objective: "a" }]);

    const result = checkpointGoal(plan, "G999", "complete", "evidence");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown goal");
  });

  it("persists and reads plan from disk", () => {
    ensureStateDir(TEST_CWD);
    const plan = createGoalPlan("Persist test", [{ title: "a", objective: "a" }]);
    writeJson(TEST_CWD, GOALS_FILE, plan);

    const loaded = readJson<GoalPlan>(TEST_CWD, GOALS_FILE);
    expect(loaded).not.toBeNull();
    expect(loaded!.brief).toBe("Persist test");
    expect(loaded!.goals).toHaveLength(1);
  });

  it("isFableActive detects active plans", () => {
    expect(isFableActive(TEST_CWD)).toBe(false);

    ensureStateDir(TEST_CWD);
    const plan = createGoalPlan("Active", [{ title: "a", objective: "a" }]);
    writeJson(TEST_CWD, GOALS_FILE, plan);

    expect(isFableActive(TEST_CWD)).toBe(true);
  });

  it("isFableActive returns false when all complete", () => {
    ensureStateDir(TEST_CWD);
    const plan = createGoalPlan("Done", [{ title: "a", objective: "a" }]);
    plan.goals[0].status = "complete";
    writeJson(TEST_CWD, GOALS_FILE, plan);

    expect(isFableActive(TEST_CWD)).toBe(false);
  });
});

describe("Findings", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("adds a finding with auto-generated ID", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    const finding = addFinding(data, {
      title: "Missing error handling",
      evidence: "importer.ts crashes on empty file",
    });

    expect(finding.id).toBe("F001");
    expect(finding.title).toBe("Missing error handling");
    expect(finding.status).toBe("open");
    expect(finding.severity).toBe("medium");
    expect(data.findings).toHaveLength(1);
  });

  it("auto-increments finding IDs", () => {
    const data: FindingsLedger = {
      created: new Date().toISOString(),
      findings: [{ id: "F001", goal: "", title: "first", severity: "low", source: "main", status: "resolved", location: "", evidence: "", resolution: "", verify_cmd: "", verify_evidence: "", created: "", updated: "" }],
    };
    const finding = addFinding(data, { title: "second", evidence: "evidence" });
    expect(finding.id).toBe("F002");
  });

  it("assigns goal from params", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    const finding = addFinding(data, {
      title: "Bug",
      evidence: "crash",
      goal: "G001",
      severity: "high",
    });
    expect(finding.goal).toBe("G001");
    expect(finding.severity).toBe("high");
  });

  it("resolves a finding", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    const finding = addFinding(data, { title: "Bug", evidence: "crash" });

    const result = resolveFinding(data, finding.id, "Fixed in importer.ts", "all tests pass");
    expect(result.success).toBe(true);
    expect(data.findings[0].status).toBe("resolved");
    expect(data.findings[0].resolution).toBe("Fixed in importer.ts");
  });

  it("rejects resolve without required fields", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    const finding = addFinding(data, { title: "Bug", evidence: "crash" });

    const result = resolveFinding(data, finding.id, "", "verified");
    expect(result.success).toBe(false);
    expect(result.error).toContain("evidence");
  });

  it("rejects resolve for unknown finding", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    const result = resolveFinding(data, "F999", "fix", "verified");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown finding");
  });

  it("rejects resolve for already resolved finding", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    const finding = addFinding(data, { title: "Bug", evidence: "crash" });
    resolveFinding(data, finding.id, "fix", "verified");

    const result = resolveFinding(data, finding.id, "fix again", "verified again");
    expect(result.success).toBe(false);
    expect(result.error).toContain("resolved");
  });

  it("rejects a finding", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    const finding = addFinding(data, { title: "Bug", evidence: "crash" });

    const result = rejectFinding(data, finding.id, "Not a real issue");
    expect(result.success).toBe(true);
    expect(data.findings[0].status).toBe("rejected");
    expect(data.findings[0].resolution).toBe("Not a real issue");
  });

  it("findings gate passes with no open findings", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    addFinding(data, { title: "Bug", evidence: "crash" });
    resolveFinding(data, "F001", "fix", "verified");

    const gate = checkFindingsGate(data);
    expect(gate.passed).toBe(true);
    expect(gate.blockers).toHaveLength(0);
  });

  it("findings gate fails with open findings", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    addFinding(data, { title: "Bug", evidence: "crash" });

    const gate = checkFindingsGate(data);
    expect(gate.passed).toBe(false);
    expect(gate.blockers).toHaveLength(1);
  });

  it("findings gate fails with blocked findings", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    const finding = addFinding(data, { title: "Bug", evidence: "crash" });
    finding.status = "blocked";

    const gate = checkFindingsGate(data);
    expect(gate.passed).toBe(false);
  });

  it("sorts findings by severity", () => {
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    addFinding(data, { title: "Low", evidence: "e", severity: "low" });
    addFinding(data, { title: "Critical", evidence: "e", severity: "critical" });
    addFinding(data, { title: "High", evidence: "e", severity: "high" });

    const sorted = sortFindings(data.findings);
    expect(sorted[0].severity).toBe("critical");
    expect(sorted[1].severity).toBe("high");
    expect(sorted[2].severity).toBe("low");
  });

  it("formats finding for display", () => {
    const finding: Finding = {
      id: "F001", goal: "G001", title: "Bug", severity: "high",
      source: "main", status: "open", location: "src/index.ts",
      evidence: "crash", resolution: "", verify_cmd: "", verify_evidence: "",
      created: "", updated: "",
    };
    const formatted = formatFinding(finding);
    expect(formatted).toContain("F001");
    expect(formatted).toContain("[open]");
    expect(formatted).toContain("high");
    expect(formatted).toContain("Bug");
    expect(formatted).toContain("goal=G001");
    expect(formatted).toContain("location=src/index.ts");
  });

  it("persists findings from disk", () => {
    ensureStateDir(TEST_CWD);
    const data: FindingsLedger = { created: new Date().toISOString(), findings: [] };
    addFinding(data, { title: "Persisted", evidence: "test" });
    writeJson(TEST_CWD, FINDINGS_FILE, data);

    const loaded = readJson<FindingsLedger>(TEST_CWD, FINDINGS_FILE);
    expect(loaded).not.toBeNull();
    expect(loaded!.findings).toHaveLength(1);
    expect(loaded!.findings[0].title).toBe("Persisted");
  });
});

describe("Edge cases", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("nextFindingId handles empty array", () => {
    const result = nextFindingId([]);
    expect(result).toBe("F001");
  });

  it("nextFindingId handles gaps in IDs", () => {
    const findings: Finding[] = [
      { id: "F001", goal: "", title: "a", severity: "low", source: "main", status: "open", location: "", evidence: "", resolution: "", verify_cmd: "", verify_evidence: "", created: "", updated: "" },
      { id: "F005", goal: "", title: "b", severity: "low", source: "main", status: "open", location: "", evidence: "", resolution: "", verify_cmd: "", verify_evidence: "", created: "", updated: "" },
    ];
    expect(nextFindingId(findings)).toBe("F006");
  });

  it("readJson returns null for corrupted JSON", () => {
    ensureStateDir(TEST_CWD);
    const { writeFileSync } = require("node:fs");
    writeFileSync(join(stateDir(TEST_CWD), "goals.json"), "not json!!!", "utf-8");
    const result = readJson<GoalPlan>(TEST_CWD, GOALS_FILE);
    expect(result).toBeNull();
  });

  it("advanceGoal mutates plan in place", () => {
    const plan = createGoalPlan("Test", [
      { title: "a", objective: "a" },
      { title: "b", objective: "b" },
    ]);
    advanceGoal(plan);
    expect(plan.goals[0].status).toBe("in_progress");
  });

  it("formatFinding omits goal and location when empty", () => {
    const finding: Finding = {
      id: "F001", goal: "", title: "Bug", severity: "low",
      source: "main", status: "open", location: "",
      evidence: "", resolution: "", verify_cmd: "", verify_evidence: "",
      created: "", updated: "",
    };
    const formatted = formatFinding(finding);
    expect(formatted).not.toContain("goal=");
    expect(formatted).not.toContain("location=");
  });
});

describe("Ledger", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  it("appends events to ledger", () => {
    ensureStateDir(TEST_CWD);
    appendLedger(TEST_CWD, "plan_created", { brief: "test", count: 2 });
    appendLedger(TEST_CWD, "story_started", { id: "G001" });

    const ledgerPath = join(stateDir(TEST_CWD), LEDGER_FILE);
    const content = readFileSync(ledgerPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.event).toBe("plan_created");
    expect(first.brief).toBe("test");

    const second = JSON.parse(lines[1]);
    expect(second.event).toBe("story_started");
    expect(second.id).toBe("G001");
  });
});
