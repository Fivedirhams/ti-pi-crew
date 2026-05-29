/**
 * HandoffManager - Generates structured summaries for agent handoffs.
 * 
 * Based on pi-boomerang's session_before_tree hook pattern:
 * - Detects task completion via agent_end hook
 * - Generates structured summaries with token metrics, artifacts, decisions
 * - Optionally collapses context to reduce token usage
 * 
 * @see docs/pi-boomerang-integration-plan.md
 */

import type { TeamEvent } from "../state/event-log.ts";
import { appendEventAsync } from "../state/event-log.ts";

/**
 * Represents a key decision made during task execution.
 */
export interface Decision {
	rationale: string;
	outcome: string;
	alternativesConsidered: string[];
}

/**
 * Structured handoff summary for passing context between agents.
 */
export interface HandoffSummary {
	taskId: string;
	runId: string;
	timestamp: number;

	// Core summary
	task: string;
	outcome: "success" | "failure" | "partial";

	// Structured artifacts
	filesCreated: string[];
	filesModified: string[];
	filesDeleted: string[];

	// Key decisions made
	decisions: Decision[];

	// Open issues / next steps
	blockers: string[];
	nextSteps: string[];

	// Metrics
	metrics: {
		tokensUsed: number;
		duration: number;
		iterations: number;
		toolsUsed: string[];
	};

	// Context snapshot
	contextSnapshot: string;
}

/**
 * Task result interface (simplified for handoff generation).
 */
export interface TaskResult {
	outcome: "success" | "failure" | "partial";
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		totalTokens?: number;
	};
	duration?: number;
	iterations?: number;
	toolsUsed?: string[];
	blockers?: string[];
	nextSteps?: string[];
	filesCreated?: string[];
	filesModified?: string[];
	filesDeleted?: string[];
	decisions?: Decision[];
	error?: string;
}

/**
 * Task packet interface (minimal for handoff generation).
 */
export interface TaskPacket {
	taskId: string;
	runId: string;
	goal: string;
	sessionId?: string;
	summarizeThreshold?: number;
	collapseContext?: boolean;
	forceSummarize?: boolean;
	context?: Record<string, unknown>;
}

export interface HandoffManagerOptions {
	/** Default token threshold for triggering summarization */
	defaultSummarizeThreshold?: number;
	/** Enable context collapse after handoff */
	enableContextCollapse?: boolean;
	/** Custom event emitter for handoff events */
	eventEmitter?: HandoffEventEmitter;
}

export interface HandoffEventEmitter {
	emit(event: string, data: unknown): void;
}

/**
 * Result of shouldSummarize check.
 */
export interface SummarizeDecision {
	shouldSummarize: boolean;
	reason: string;
	tokenCount: number;
}

/**
 * HandoffManager generates structured summaries when agents complete tasks,
 * enabling efficient context passing to subsequent agents.
 */
export class HandoffManager {
	private pendingHandoffs = new Map<string, HandoffSummary>();
	private options: HandoffManagerOptions;

	constructor(options: HandoffManagerOptions = {}) {
		this.options = options;
	}

	/**
	 * Hook: agent_end
	 * Called when agent completes a task.
	 * 
	 * @param packet - The task packet
	 * @param result - The task result
	 */
	async onAgentEnd(packet: TaskPacket, result: TaskResult): Promise<HandoffSummary | null> {
		// Check if summarization is needed
		if (!this.shouldSummarize(packet, result).shouldSummarize) {
			return null;
		}

		// Generate handoff summary
		const summary = await this.generateSummary(packet, result);

		// Store pending handoff for tree navigation
		if (packet.sessionId) {
			this.pendingHandoffs.set(packet.sessionId, summary);
		}

		// Emit handoff event
		this.options.eventEmitter?.emit("handoff:generated", { packet, summary });

		// Optionally collapse context
		if (packet.collapseContext) {
			await this.collapseContext(packet, summary);
		}

		return summary;
	}

	/**
	 * Hook: session_before_tree
	 * Called before navigating to tree view.
	 * Injects pending handoff summaries into the tree.
	 * 
	 * @param sessionId - The session ID
	 * @param targetId - The target tree node ID
	 */
	async onBeforeTreeNavigation(sessionId: string, targetId: string): Promise<HandoffSummary | null> {
		const pendingHandoff = this.pendingHandoffs.get(sessionId);

		if (pendingHandoff) {
			// Clear the pending handoff after injection
			this.pendingHandoffs.delete(sessionId);
			return pendingHandoff;
		}

		return null;
	}

	/**
	 * Check if summarization should be performed.
	 */
	shouldSummarize(packet: TaskPacket, result: TaskResult): SummarizeDecision {
		const threshold = packet.summarizeThreshold ?? this.options.defaultSummarizeThreshold ?? 5000;
		const tokenCount = result.usage?.totalTokens ?? 0;

		// Summarize if:
		// 1. Task exceeded threshold tokens
		if (tokenCount > threshold) {
			return {
				shouldSummarize: true,
				reason: `Token count ${tokenCount} exceeds threshold ${threshold}`,
				tokenCount,
			};
		}

		// 2. Task completed with significant work (3 or more tools used)
		if (result.outcome === "success" && (result.toolsUsed?.length ?? 0) >= 3) {
			return {
				shouldSummarize: true,
				reason: `Task used ${result.toolsUsed?.length ?? 0} tools, exceeding minimum of 3`,
				tokenCount,
			};
		}

		// 3. Explicitly requested
		if (packet.forceSummarize === true) {
			return {
				shouldSummarize: true,
				reason: "Forced summarization requested",
				tokenCount,
			};
		}

		// 4. Task has significant artifacts or decisions
		const hasArtifacts = (result.filesCreated?.length ?? 0) > 0 ||
			(result.filesModified?.length ?? 0) > 0;
		const hasDecisions = (result.decisions?.length ?? 0) > 0;

		if (hasArtifacts || hasDecisions) {
			return {
				shouldSummarize: true,
				reason: "Task produced significant artifacts or decisions",
				tokenCount,
			};
		}

		// 5. Task outcome is not success (failure or partial)
		if (result.outcome !== "success") {
			return {
				shouldSummarize: true,
				reason: `Task outcome is ${result.outcome}`,
				tokenCount,
			};
		}

		return {
			shouldSummarize: false,
			reason: "Task below summarization threshold",
			tokenCount,
		};
	}

	/**
	 * Generate a structured handoff summary.
	 */
	async generateSummary(packet: TaskPacket, result: TaskResult): Promise<HandoffSummary> {
		const artifacts = this.extractArtifacts(result);
		// Use extractDecisionsFromResult to handle empty array and generate defaults
		const decisions = this.extractDecisionsFromResult(result);
		const contextSnapshot = await this.generateContextSnapshot(
			packet.runId,
			packet.taskId,
			result
		);

		return {
			taskId: packet.taskId,
			runId: packet.runId,
			timestamp: Date.now(),

			task: packet.goal,
			outcome: result.outcome,

			filesCreated: artifacts.created,
			filesModified: artifacts.modified,
			filesDeleted: artifacts.deleted,

			decisions,
			blockers: result.blockers ?? [],
			nextSteps: result.nextSteps ?? [],

			metrics: {
				tokensUsed: result.usage?.totalTokens ?? 0,
				duration: result.duration ?? 0,
				iterations: result.iterations ?? 1,
				toolsUsed: result.toolsUsed ?? [],
			},

			contextSnapshot,
		};
	}

	/**
	 * Collapse context after handoff.
	 * Signals to other extensions not to prompt during collapse.
	 */
	async collapseContext(packet: TaskPacket, summary: HandoffSummary): Promise<void> {
		// Set global flag to signal collapse in progress
		(globalThis as Record<string, unknown>).__boomerangCollapseInProgress = true;

		try {
			// Emit event that context will be collapsed
			this.options.eventEmitter?.emit("handoff:context_collapse", {
				sessionId: packet.sessionId,
				taskId: packet.taskId,
				summary,
			});
		} finally {
			// Clear the flag
			(globalThis as Record<string, unknown>).__boomerangCollapseInProgress = false;
		}
	}

	/**
	 * Get pending handoff for a session.
	 */
	getPendingHandoff(sessionId: string): HandoffSummary | undefined {
		return this.pendingHandoffs.get(sessionId);
	}

	/**
	 * Clear pending handoff for a session.
	 */
	clearPendingHandoff(sessionId: string): void {
		this.pendingHandoffs.delete(sessionId);
	}

	/**
	 * Extract file artifacts from task result.
	 */
	private extractArtifacts(result: TaskResult): {
		created: string[];
		modified: string[];
		deleted: string[];
	} {
		return {
			created: result.filesCreated ?? [],
			modified: result.filesModified ?? [],
			deleted: result.filesDeleted ?? [],
		};
	}

	/**
	 * Extract decisions from task result.
	 */
	private extractDecisionsFromResult(result: TaskResult): Decision[] {
		if (result.decisions && result.decisions.length > 0) {
			return result.decisions;
		}

		// Generate a default decision for failure outcomes
		if (result.outcome === "failure") {
			return [{
				rationale: "Task failed",
				outcome: result.error ?? "Unknown error",
				alternativesConsidered: [],
			}];
		}

		return [];
	}

	/**
	 * Generate context snapshot for handoff.
	 */
	private async generateContextSnapshot(
		runId: string,
		taskId: string,
		result: TaskResult
	): Promise<string> {
		const parts: string[] = [];

		parts.push(`Task: ${taskId}`);
		parts.push(`Outcome: ${result.outcome}`);

		if (result.usage?.totalTokens) {
			parts.push(`Tokens: ${result.usage.totalTokens}`);
		}

		if (result.toolsUsed?.length) {
			parts.push(`Tools: ${result.toolsUsed.join(", ")}`);
		}

		if (result.blockers?.length) {
			parts.push(`Blockers: ${result.blockers.join("; ")}`);
		}

		if (result.nextSteps?.length) {
			parts.push(`Next Steps: ${result.nextSteps.join("; ")}`);
		}

		return parts.join("\n");
	}
}

/**
 * Create a HandoffManager with default options.
 */
export function createHandoffManager(options?: HandoffManagerOptions): HandoffManager {
	return new HandoffManager(options);
}