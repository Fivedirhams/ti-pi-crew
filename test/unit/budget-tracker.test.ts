import { EventEmitter } from "node:events";
import test from "node:test";
import assert from "node:assert/strict";
import { TeamBudgetTracker, createBudgetConfig, validateBudgetConfig, type BudgetConfig } from "../../src/runtime/budget-tracker.ts";

test("TeamBudgetTracker tracks usage correctly", () => {
  const tracker = new TeamBudgetTracker({ total: 10000 });
  tracker.trackUsage(1000);
  assert.equal(tracker.spent(), 1000);
  assert.equal(tracker.remaining(), 9000);
});

test("TeamBudgetTracker tracks multiple usage increments", () => {
  const tracker = new TeamBudgetTracker({ total: 10000 });
  tracker.trackUsage(2000);
  tracker.trackUsage(3000);
  tracker.trackUsage(1500);
  assert.equal(tracker.spent(), 6500);
  assert.equal(tracker.remaining(), 3500);
});

test("TeamBudgetTracker triggers warning at threshold", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, warningThreshold: 0.5 });
  tracker.trackUsage(5000);
  assert.equal(tracker.warning(), true);
});

test("TeamBudgetTracker warning is false below threshold", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, warningThreshold: 0.5 });
  tracker.trackUsage(4999);
  assert.equal(tracker.warning(), false);
});

test("TeamBudgetTracker is exhausted at abort threshold", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, abortThreshold: 0.9 });
  tracker.trackUsage(9000);
  assert.equal(tracker.exhausted(), true);
});

test("TeamBudgetTracker exhausted is false below threshold", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, abortThreshold: 0.9 });
  tracker.trackUsage(8999);
  assert.equal(tracker.exhausted(), false);
});

test("TeamBudgetTracker default thresholds are 80% warning and 95% abort", () => {
  const tracker = new TeamBudgetTracker({ total: 10000 });
  tracker.trackUsage(8000);
  assert.equal(tracker.warning(), true, "80% should trigger warning");
  assert.equal(tracker.exhausted(), false, "80% should not trigger exhaust");

  tracker.trackUsage(1500); // 9500 total = 95%
  assert.equal(tracker.exhausted(), true, "95% should trigger exhaust");
});

test("TeamBudgetTracker emits warning event once", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, warningThreshold: 0.5 });
  let warningCount = 0;
  tracker.on("warning", () => warningCount++);

  tracker.trackUsage(4000); // 40%
  assert.equal(warningCount, 0);
  tracker.trackUsage(2000); // 60% - crosses threshold
  assert.equal(warningCount, 1);
  tracker.trackUsage(1000); // 70% - already warning
  assert.equal(warningCount, 1, "Warning event should fire only once");
});

test("TeamBudgetTracker emits exhausted event once", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, abortThreshold: 0.8 });
  let exhaustedCount = 0;
  tracker.on("exhausted", () => exhaustedCount++);

  tracker.trackUsage(7000); // 70%
  assert.equal(exhaustedCount, 0);
  tracker.trackUsage(1500); // 85% - crosses threshold
  assert.equal(exhaustedCount, 1);
  tracker.trackUsage(1000); // 95%
  assert.equal(exhaustedCount, 1, "Exhausted event should fire only once");
});

test("TeamBudgetTracker trackUsage returns usage record", () => {
  const tracker = new TeamBudgetTracker({ total: 10000 });
  const record = tracker.trackUsage(5000);

  assert.equal(record.totalSpent, 5000);
  assert.equal(record.delta, 5000);
  assert.equal(record.isWarning, false);
  assert.equal(record.isExhausted, false);

  tracker.trackUsage(3500); // 85%
  const record2 = tracker.trackUsage(3000); // 115% - over budget but still tracks
  assert.equal(record2.delta, 3000);
  assert.equal(record2.isWarning, true);
});

test("TeamBudgetTracker throws on negative tokens", () => {
  const tracker = new TeamBudgetTracker({ total: 10000 });
  assert.throws(
    () => tracker.trackUsage(-100),
    /trackUsage: tokens must be non-negative/,
  );
});

test("TeamBudgetTracker percentUsed calculation", () => {
  const tracker = new TeamBudgetTracker({ total: 10000 });
  assert.equal(tracker.percentUsed(), 0);
  tracker.trackUsage(2500);
  assert.equal(tracker.percentUsed(), 0.25);
  tracker.trackUsage(2500);
  assert.equal(tracker.percentUsed(), 0.5);
});

test("TeamBudgetTracker percentUsed returns 0 when total is 0", () => {
  const tracker = new TeamBudgetTracker({ total: 0 });
  assert.equal(tracker.percentUsed(), 0);
});

test("TeamBudgetTracker createAbortSignal is immediately aborted if exhausted", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, abortThreshold: 0.5 });
  tracker.trackUsage(6000); // 60% > 50% threshold
  assert.equal(tracker.exhausted(), true);

  const signal = tracker.createAbortSignal();
  assert.equal(signal.aborted, true);
});

test("TeamBudgetTracker createAbortSignal aborts when exhausted", async () => {
  const tracker = new TeamBudgetTracker({ total: 10000, abortThreshold: 0.5 });
  const signal = tracker.createAbortSignal();
  assert.equal(signal.aborted, false);

  // Simulate exhaustion
  tracker.trackUsage(5500); // 55% > 50% threshold

  // Wait for interval check
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(signal.aborted, true);
});

test("TeamBudgetTracker phase breakdown tracking", () => {
  const tracker = new TeamBudgetTracker({ total: 10000 });
  tracker.trackUsage(1000, "phase1");
  tracker.trackUsage(2000, "phase1");
  tracker.trackUsage(500, "phase2");
  tracker.trackUsage(1500, "phase2");
  tracker.trackUsage(3000, "phase1"); // accumulate more

  const breakdown = tracker.getPhaseBreakdown();
  assert.equal(breakdown.length, 2);

  const phase1 = breakdown.find((p) => p.phaseName === "phase1");
  const phase2 = breakdown.find((p) => p.phaseName === "phase2");
  assert.ok(phase1, "phase1 should exist");
  assert.ok(phase2, "phase2 should exist");
  assert.equal(phase1!.tokens, 6000, "phase1 tokens should be 6000");
  assert.equal(phase2!.tokens, 2000, "phase2 tokens should be 2000");
});

test("TeamBudgetTracker resetUsage clears usage but not emitted flags", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, warningThreshold: 0.5 });
  tracker.trackUsage(6000); // crosses warning

  assert.equal(tracker.spent(), 6000);
  assert.equal(tracker.isWarningEmitted(), true);

  tracker.resetUsage();
  assert.equal(tracker.spent(), 0);
  assert.equal(tracker.isWarningEmitted(), true, "Emitted flag should persist");
  assert.equal(tracker.warning(), false, "Warning cleared after resetUsage");
});

test("TeamBudgetTracker resetAll clears everything", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, warningThreshold: 0.5 });
  tracker.trackUsage(6000);

  assert.equal(tracker.isWarningEmitted(), true);
  tracker.resetAll();

  assert.equal(tracker.spent(), 0);
  assert.equal(tracker.isWarningEmitted(), false);
  assert.equal(tracker.warning(), false);
});

test("TeamBudgetTracker snapshot returns current state", () => {
  const tracker = new TeamBudgetTracker({ total: 10000 });
  tracker.trackUsage(2500);

  const snapshot = tracker.snapshot();
  assert.equal(snapshot.total, 10000);
  assert.equal(snapshot.spent, 2500);
  assert.equal(snapshot.remaining, 7500);
  assert.equal(snapshot.percentUsed, 0.25);
});

test("TeamBudgetTracker totalBudget getter", () => {
  const tracker = new TeamBudgetTracker({ total: 50000 });
  assert.equal(tracker.totalBudget, 50000);
});

test("createBudgetConfig creates config with defaults", () => {
  const config = createBudgetConfig(100000);
  assert.equal(config.total, 100000);
  assert.equal(config.warningThreshold, 0.8);
  assert.equal(config.abortThreshold, 0.95);
});

test("createBudgetConfig accepts custom thresholds", () => {
  const config = createBudgetConfig(100000, 0.7, 0.9);
  assert.equal(config.warningThreshold, 0.7);
  assert.equal(config.abortThreshold, 0.9);
});

test("validateBudgetConfig accepts valid configs", () => {
  const valid = validateBudgetConfig({ total: 10000, warningThreshold: 0.7, abortThreshold: 0.9 });
  assert.equal(valid.valid, true);

  const validDefaults = validateBudgetConfig({ total: 10000 });
  assert.equal(validDefaults.valid, true);
});

test("validateBudgetConfig rejects invalid total", () => {
  const result1 = validateBudgetConfig({ total: 0 });
  assert.equal(result1.valid, false);
  assert.ok(result1.error?.includes("total"));

  const result2 = validateBudgetConfig({ total: -100 } as BudgetConfig);
  assert.equal(result2.valid, false);
});

test("validateBudgetConfig rejects invalid thresholds", () => {
  const result1 = validateBudgetConfig({ total: 10000, warningThreshold: -0.1 });
  assert.equal(result1.valid, false);
  assert.ok(result1.error?.includes("warningThreshold"));

  const result2 = validateBudgetConfig({ total: 10000, warningThreshold: 1.5 });
  assert.equal(result2.valid, false);

  const result3 = validateBudgetConfig({ total: 10000, abortThreshold: -0.1 });
  assert.equal(result3.valid, false);
  assert.ok(result3.error?.includes("abortThreshold"));
});

test("validateBudgetConfig rejects warning >= abort", () => {
  const result1 = validateBudgetConfig({ total: 10000, warningThreshold: 0.9, abortThreshold: 0.8 });
  assert.equal(result1.valid, false);
  assert.ok(result1.error?.includes("warningThreshold must be less than abortThreshold"));

  const result2 = validateBudgetConfig({ total: 10000, warningThreshold: 0.8, abortThreshold: 0.8 });
  assert.equal(result2.valid, false);
});

test("TeamBudgetTracker handles large token values", () => {
  const tracker = new TeamBudgetTracker({ total: 1_000_000_000 }); // 1B tokens
  tracker.trackUsage(850_000_000); // 85% - crosses 80% warning threshold
  assert.equal(tracker.spent(), 850_000_000);
  assert.equal(tracker.warning(), true);
  assert.equal(tracker.exhausted(), false, "85% < 95% abort threshold");
});

test("TeamBudgetTracker handles fractional thresholds", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, warningThreshold: 0.333, abortThreshold: 0.666 });
  tracker.trackUsage(3333);
  assert.equal(tracker.warning(), true);
  assert.equal(tracker.exhausted(), false);

  tracker.resetAll();
  tracker.trackUsage(6667);
  assert.equal(tracker.exhausted(), true);
});

test("TeamBudgetTracker update threshold mid-tracking", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, warningThreshold: 0.5 });
  tracker.trackUsage(4000); // 40%
  assert.equal(tracker.warning(), false);

  // Can't modify thresholds after construction (read-only fields)
  // This is by design - config is set at construction
  tracker.trackUsage(2000); // 60%
  assert.equal(tracker.warning(), true);
});

test("TeamBudgetTracker EventEmitter inheritance", () => {
  const tracker = new TeamBudgetTracker({ total: 10000 });
  assert.ok(tracker instanceof EventEmitter);

  const events: string[] = [];
  tracker.on("warning", () => events.push("warning"));
  tracker.on("exhausted", () => events.push("exhausted"));

  tracker.trackUsage(8500); // 85% - warning threshold (80%) only
  assert.deepEqual(events, ["warning"]);

  tracker.trackUsage(1000); // 95% - exhausted threshold (95%)
  assert.deepEqual(events, ["warning", "exhausted"]);
});

test("TeamBudgetTracker removeListener", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, warningThreshold: 0.5 });
  let count = 0;
  const handler = () => count++;

  tracker.on("warning", handler);
  tracker.trackUsage(6000);
  assert.equal(count, 1);

  tracker.removeListener("warning", handler);
  tracker.trackUsage(1000);
  assert.equal(count, 1, "Handler should not fire after removal");
});

test("TeamBudgetTracker using once", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, warningThreshold: 0.5 });
  let count = 0;
  tracker.once("warning", () => count++);

  tracker.trackUsage(6000);
  assert.equal(count, 1);
  tracker.trackUsage(1000);
  assert.equal(count, 1, "once handler should only fire once");
});

test("TeamBudgetTracker edge case - exactly at threshold", () => {
  const tracker = new TeamBudgetTracker({ total: 10000, warningThreshold: 0.5, abortThreshold: 0.9 });

  tracker.trackUsage(5000); // exactly 50%
  assert.equal(tracker.warning(), true, "At threshold should trigger warning");
  assert.equal(tracker.exhausted(), false);

  tracker.resetAll();
  tracker.trackUsage(9000); // exactly 90%
  assert.equal(tracker.exhausted(), true, "At threshold should trigger exhaust");
  assert.equal(tracker.warning(), true);
});

test("TeamBudgetTracker over budget tracking", () => {
  const tracker = new TeamBudgetTracker({ total: 10000 });
  tracker.trackUsage(8000);
  tracker.trackUsage(3000); // 110% of budget
  assert.equal(tracker.spent(), 11000);
  assert.equal(tracker.remaining(), -1000);
  assert.equal(tracker.exhausted(), true);
});

test("TeamBudgetTracker totalBudget property matches config", () => {
  const configs = [1000, 10000, 100000, 1000000];
  for (const total of configs) {
    const tracker = new TeamBudgetTracker({ total });
    assert.equal(tracker.totalBudget, total);
  }
});