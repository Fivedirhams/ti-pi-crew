/**
 * Tasks Widget - интерактивный виджет для управления task/spec/agent
 * 
 * Показывает:
 * 1. Active Tasks - статус и прогресс
 * 2. Quick Actions - формирование запроса
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { type Component, Box, Text } from "@earendil-works/pi-tui";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { asCrewTheme, subscribeThemeChange } from "../theme-adapter.ts";
import type { CrewTheme } from "../theme-adapter.ts";
import { spinnerFrame } from "../spinner.ts";

// ── Types ───────────────────────────────────────────────────────────────

export interface PiOpsIndex {
	version: string;
	spec_counter: number;
	task_counter: number;
	specs: Record<string, SpecEntry>;
	tasks: Record<string, TaskEntry>;
}

export interface SpecEntry {
	id: string;
	title: string;
	version: number;
	status: "active" | "completed" | "archived";
	tasks: string[];
	created_at: string;
	updated_at: string;
}

export interface TaskEntry {
	id: string;
	spec_id: string | null;
	template: string;
	title: string;
	version: number;
	status: "todo" | "in_progress" | "completed" | "failed";
	stage: string | null;
	created_at: string;
	updated_at: string;
}

export interface RunEntry {
	id: string;
	task_id: string;
	agent_name?: string;
	status: "started" | "completed" | "failed";
	started_at: string;
	completed_at?: string;
	stage?: string;
}

// ── Widget State ───────────────────────────────────────────────────────

export interface TasksWidgetState {
	selectedSpec: string | null;
	selectedTask: string | null;
	selectedTemplate: string;
	inputGoal: string;
	view: "main" | "specs" | "tasks" | "actions";
	activeTab: "status" | "actions";
}

export const DEFAULT_TASKS_WIDGET_STATE: TasksWidgetState = {
	selectedSpec: null,
	selectedTask: null,
	selectedTemplate: "implementation",
	inputGoal: "",
	view: "main",
	activeTab: "status",
};

// ── Constants ───────────────────────────────────────────────────────────

const WIDGET_KEY = "pi-crew-tasks";
const STATUS_KEY = "pi-crew-tasks-status";

export const TEMPLATES = [
	"implementation",
	"research",
	"planning",
	"fast-fix",
	"review",
	"spec",
	"specify",
];

// ── Read piOps ─────────────────────────────────────────────────────────

export function readPiOpsIndex(): PiOpsIndex {
	const indexPath = path.join(os.homedir(), ".pi", "agent", "piops", "index.json");
	try {
		if (fs.existsSync(indexPath)) {
			return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
		}
	} catch {
		// ignore
	}
	return { version: "1.0", spec_counter: 0, task_counter: 0, specs: {}, tasks: {} };
}

export function readRuns(): RunEntry[] {
	const runsPath = path.join(os.homedir(), ".pi", "agent", "piops", "runs.json");
	try {
		if (fs.existsSync(runsPath)) {
			return JSON.parse(fs.readFileSync(runsPath, "utf-8"));
		}
	} catch {
		// ignore
	}
	return [];
}

// ── Widget Component ──────────────────────────────────────────────────

export class TasksWidgetComponent implements Component {
	private state: TasksWidgetState;
	private theme: CrewTheme;
	private index: PiOpsIndex;
	private runs: RunEntry[];
	private readonly unsubscribe: () => void;

	constructor(state: TasksWidgetState, themeLike: unknown, index: PiOpsIndex, runs: RunEntry[]) {
		this.state = state;
		this.theme = asCrewTheme(themeLike);
		this.index = index;
		this.runs = runs;
		this.unsubscribe = subscribeThemeChange(themeLike, () => this.invalidate());
	}

	invalidate(): void {
		// Refresh data
		this.index = readPiOpsIndex();
		this.runs = readRuns();
	}

	handleInput?(data: string): void {
		// Basic navigation - can be extended
		if (data === "escape") {
			// Close widget - handled by parent
		}
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const fg = this.theme.fg.bind(this.theme);
		const bg = this.theme.bg.bind(this.theme);

		// ── Tab: Active Tasks Status ─────────────────────────────────────
		if (this.state.activeTab === "status") {
			lines.push(fg("accent", "📊 ACTIVE TASKS") + fg("dim", " · press Tab for actions"));
			
			const tasks = Object.values(this.index.tasks);
			const activeTasks = tasks.filter(t => t.status === "in_progress");
			
			if (activeTasks.length === 0) {
				lines.push(fg("muted", "  No active tasks"));
			}
			
			for (const task of activeTasks.slice(0, 5)) {
				const spec = task.spec_id ? this.index.specs[task.spec_id] : null;
				const taskRuns = this.runs.filter(r => r.task_id === task.id);
				const completed = taskRuns.filter(r => r.status === "completed").length;
				const total = taskRuns.length;
				
				const specName = spec ? ` (${spec.id})` : "";
				const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
				const bar = this.renderProgressBar(progress, 10);
				
				lines.push(`  ${fg("accent", "●")} ${task.id}${specName} ${fg("muted", bar + " " + progress + "%")}`);
				
				// Show stages
				const stages = [...new Set(taskRuns.map(r => r.stage).filter(Boolean))];
				for (const stage of stages.slice(0, 3)) {
					const stageRun = taskRuns.find(r => r.stage === stage);
					const icon = stageRun?.status === "completed" ? "✓" : stageRun?.status === "failed" ? "✗" : "○";
					lines.push(`    ${fg("muted", icon + " " + stage)}`);
				}
			}
			
			// Completed tasks
			const completedTasks = tasks.filter(t => t.status === "completed").slice(0, 3);
			if (completedTasks.length > 0) {
				lines.push(fg("dim", "  ── Completed ──"));
				for (const task of completedTasks) {
					lines.push(`  ${fg("success", "✓")} ${task.id} ${fg("muted", task.title.slice(0, 30))}`);
				}
			}
		}

		// ── Tab: Quick Actions ───────────────────────────────────────────
		else if (this.state.activeTab === "actions") {
			lines.push(fg("accent", "⚡ QUICK ACTIONS") + fg("dim", " · press Tab for status"));
			
			// Spec selector
			const specs = Object.values(this.index.specs);
			const specOptions = ["(new)", ...specs.map(s => s.id + ": " + s.title.slice(0, 20))];
			const currentSpec = this.state.selectedSpec 
				? this.index.specs[this.state.selectedSpec]?.id + ": " + this.index.specs[this.state.selectedSpec]?.title.slice(0, 20)
				: "(any)";
			
			lines.push(fg("muted", `  Spec: [`) + fg("accent", currentSpec) + fg("muted", "]") + fg("dim", " · [1]"));
			
			// Task selector - depends on spec
			let taskOptions = ["(new)", "(continue existing)"];
			if (this.state.selectedSpec && this.index.specs[this.state.selectedSpec]) {
				const spec = this.index.specs[this.state.selectedSpec];
				taskOptions = ["(new)", ...spec.tasks.map(t => {
					const task = this.index.tasks[t];
					return task ? `${t}: ${task.title.slice(0, 20)}` : t;
				})];
			}
			const currentTask = this.state.selectedTask 
				? `${this.state.selectedTask}`
				: "(any)";
			lines.push(fg("muted", `  Task: [`) + fg("accent", currentTask) + fg("muted", "]") + fg("dim", " · [2]"));
			
			// Template selector
			lines.push(fg("muted", `  Template: [`) + fg("accent", this.state.selectedTemplate) + fg("muted", "]") + fg("dim", " · [3]"));
			lines.push(fg("dim", `    ${TEMPLATES.join(" | ")}`).slice(0, width - 4));
			
			// Goal input
			lines.push(fg("muted", "  Goal: ") + (this.state.inputGoal ? fg("default", this.state.inputGoal.slice(0, 40)) : fg("muted", "(enter your request)")));
			
			// Action buttons
			lines.push(fg("dim", "  ─────────────────────────────────"));
			lines.push(`  [${fg("accent", "▶ RUN")}] ${fg("dim", "[enter]")}   [${fg("warning", "✕ CLEAR")}] ${fg("dim", "[c]")}`);
		}

		return lines;
	}

	private renderProgressBar(percent: number, width: number): string {
		const filled = Math.round((percent / 100) * width);
		const empty = width - filled;
		return "█".repeat(filled) + "░".repeat(empty);
	}
}

// ── Main functions ────────────────────────────────────────────────────

export function updateTasksWidget(
	ctx: Pick<ExtensionContext, "hasUI" | "ui" | "cwd" | "sessionManager">,
	state: TasksWidgetState,
): void {
	if (!ctx.hasUI) return;

	const index = readPiOpsIndex();
	const runs = readRuns();
	
	// Build content
	const lines = buildTasksWidgetLines(state, index, runs);
	const theme = ctx.ui.theme;
	
	// Set status
	ctx.ui.setStatus(STATUS_KEY, lines.length ? `tasks: ${Object.keys(index.tasks).length} active` : undefined);
	
	// Set widget
	ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "aboveEditor" });
}

export function stopTasksWidget(
	ctx: Pick<ExtensionContext, "hasUI" | "ui">,
): void {
	if (ctx?.hasUI) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWidget(WIDGET_KEY, undefined, { placement: "aboveEditor" });
	}
}

export function buildTasksWidgetLines(
	state: TasksWidgetState,
	index: PiOpsIndex,
	runs: RunEntry[],
): string[] {
	const lines: string[] = [];
	
	if (state.activeTab === "status") {
		lines.push("📊 ACTIVE TASKS");
		
		const tasks = Object.values(index.tasks);
		const activeTasks = tasks.filter(t => t.status === "in_progress");
		
		if (activeTasks.length === 0) {
			lines.push("  No active tasks");
			return lines;
		}
		
		for (const task of activeTasks.slice(0, 5)) {
			const spec = task.spec_id ? index.specs[task.spec_id] : null;
			const taskRuns = runs.filter(r => r.task_id === task.id);
			const completed = taskRuns.filter(r => r.status === "completed").length;
			const total = taskRuns.length;
			
			const specName = spec ? ` (${spec.id})` : "";
			const progress = total > 0 ? Math.round((completed / total) * 100) : 0;
			const bar = "█".repeat(Math.round(progress / 10)) + "░".repeat(10 - Math.round(progress / 10));
			
			lines.push(`  ● ${task.id}${specName} [${bar}] ${progress}%`);
			
			// Show stages
			const stages = [...new Set(taskRuns.map(r => r.stage).filter(Boolean))];
			for (const stage of stages.slice(0, 3)) {
				const stageRun = taskRuns.find(r => r.stage === stage);
				const icon = stageRun?.status === "completed" ? "✓" : stageRun?.status === "failed" ? "✗" : "○";
				lines.push(`    ${icon} ${stage}`);
			}
		}
		
		// Completed tasks
		const completedTasks = tasks.filter(t => t.status === "completed").slice(0, 3);
		if (completedTasks.length > 0) {
			lines.push("  ── Completed ──");
			for (const task of completedTasks) {
				lines.push(`  ✓ ${task.id} ${task.title.slice(0, 30)}`);
			}
		}
	}
	
	else if (state.activeTab === "actions") {
		lines.push("⚡ QUICK ACTIONS");
		
		const specs = Object.values(index.specs);
		const specOptions = ["(new)", ...specs.map(s => s.id + ": " + s.title.slice(0, 20))];
		const currentSpec = state.selectedSpec 
			? index.specs[state.selectedSpec]?.id + ": " + index.specs[state.selectedSpec]?.title.slice(0, 20)
			: "(any)";
		
		lines.push(`  Spec: [${currentSpec}]`);
		
		// Task selector
		let taskOptions = ["(new)", "(continue existing)"];
		if (state.selectedSpec && index.specs[state.selectedSpec]) {
			const spec = index.specs[state.selectedSpec];
			taskOptions = ["(new)", ...spec.tasks.map(t => {
				const task = index.tasks[t];
				return task ? `${t}: ${task.title.slice(0, 20)}` : t;
			})];
		}
		const currentTask = state.selectedTask 
			? state.selectedTask
			: "(any)";
		lines.push(`  Task: [${currentTask}]`);
		
		// Template selector
		lines.push(`  Template: [${state.selectedTemplate}]`);
		lines.push(`    ${TEMPLATES.join(" | ")}`);
		
		// Goal input
		lines.push(`  Goal: ${state.inputGoal || "(enter your request)"}`);
		
		// Action buttons
		lines.push("  ─────────────────────────────────");
		lines.push(`  [▶ RUN] [enter]   [✕ CLEAR] [c]`);
	}
	
	return lines;
}
