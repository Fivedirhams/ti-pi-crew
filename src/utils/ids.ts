import { randomBytes } from "node:crypto";
import { generateTaskName } from "./task-name-generator.ts";

export function createRunId(prefix = "team"): string {
	const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
	const suffix = randomBytes(8).toString("hex");
	return `${prefix}_${stamp}_${suffix}`;
}

export function createTaskId(stepId: string, index: number): string {
	const normalized = stepId.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "task";
	return `${String(index + 1).padStart(2, "0")}_${normalized}`;
}

export function createDisplayName(): string {
	return generateTaskName();
}
