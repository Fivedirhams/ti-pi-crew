/**
 * ChainRunner - Execute sequential chains with `->` syntax support.
 * 
 * Based on pi-boomerang's parseChain pattern:
 * - Parses "teamA -> teamB -> teamC" syntax
 * - Supports per-step overrides for model, skill, thinking
 * - Accumulates handoffs between steps
 * - Executes steps sequentially with context passing
 * 
 * @see docs/pi-boomerang-integration-plan.md
 */

import type { HandoffSummary, HandoffManager, TaskPacket, TaskResult } from "./handoff-manager.ts";

/**
 * Single step in a chain.
 */
export interface ChainStep {
	/** Step name/identifier */
	name: string;
	/** Team to execute (if using team reference) */
	team?: string;
	/** Workflow to execute (if using workflow reference) */
	workflow?: string;
	/** Template to execute (if using template reference) */
	template?: string;
	/** Inline goal text (for literal goals) */
	inlineGoal?: string;

	/** Per-step model override */
	model?: string;
	/** Per-step skill override */
	skill?: string;
	/** Thinking mode */
	thinking?: "fast" | "standard" | "deep";

	/** Step-specific context */
	context?: Record<string, unknown>;
	/** Step timeout in milliseconds */
	timeout?: number;

	/** Whether to continue chain on failure */
	continueOnError?: boolean;
}

/**
 * Parsed chain specification.
 */
export interface ChainSpec {
	/** Ordered steps in the chain */
	steps: ChainStep[];
	/** Global arguments applied to all steps */
	globalArgs?: Record<string, unknown>;
	/** Global model override */
	globalModel?: string;
	/** Global skill override */
	globalSkill?: string;
	/** Global thinking mode */
	globalThinking?: "fast" | "standard" | "deep";
	/** Continue chain on step failure */
	continueOnError?: boolean;
}

/**
 * Result of a single chain step execution.
 */
export interface ChainStepResult {
	step: number;
	name: string;
	outcome: "success" | "failure" | "skipped" | "partial";
	result?: TaskResult;
	handoff?: HandoffSummary;
	duration: number;
	error?: string;
}

/**
 * Final chain execution result.
 */
export interface ChainResult {
	steps: ChainStepResult[];
	totalDuration: number;
	success: boolean;
	/** Total tokens used across all steps */
	totalTokens?: number;
	/** All handoffs generated during chain */
	totalHandoffs: HandoffSummary[];
}

/**
 * Task runner interface for chain execution.
 */
export interface ChainTaskRunner {
	runTask(packet: TaskPacket): Promise<TaskResult>;
}

/**
 * ChainRunner executes sequential chains with context passing.
 */
export class ChainRunner {
	constructor(
		private taskRunner: ChainTaskRunner,
		private handoffManager: HandoffManager,
	) {}

	/**
	 * Parse chain syntax: step1 -> step2 -> step3
	 * 
	 * Supports multiple syntaxes:
	 * - Team reference: @teamName
	 * - Workflow reference: workflow:name
	 * - Template reference: template:name
	 * - Inline goal: "goal description"
	 * 
	 * @example
	 * parseChain("@research -> @implement -> @review")
	 * parseChain('"Research AI trends" -> "Analyze findings"')
	 * parseChain("@step1 --model claude-opus-3 -> @step2")
	 * 
	 * @param chainString - The chain string to parse
	 * @returns Parsed chain specification
	 */
	parseChain(chainString: string): ChainSpec {
		const stepStrings = chainString.split("->").map(s => s.trim());

		const steps: ChainStep[] = stepStrings.map((step, index) => {
			return this.parseStep(step, index);
		});

		// Extract global overrides
		const globalModel = this.extractGlobalFlag(chainString, "global-model");
		const globalSkill = this.extractGlobalFlag(chainString, "global-skill");
		const globalThinking = this.extractGlobalFlag(chainString, "global-thinking") as "fast" | "standard" | "deep" | undefined;
		const continueOnError = this.extractGlobalFlag(chainString, "continue-on-error") === "true";

		return {
			steps,
			globalModel,
			globalSkill,
			globalThinking,
			continueOnError,
		};
	}

	/**
	 * Execute chain sequentially.
	 * Each step receives handoff from previous step.
	 * 
	 * @param spec - Parsed chain specification
	 * @param initialContext - Initial context for the chain
	 * @param eventsPath - Optional event log path for events
	 * @returns Final chain result
	 */
	async runChain(
		spec: ChainSpec,
		initialContext: Record<string, unknown> = {},
		eventsPath?: string
	): Promise<ChainResult> {
		const stepResults: ChainStepResult[] = [];
		let accumulatedContext = { ...initialContext };
		const startTime = Date.now();
		let totalTokens = 0;
		const allHandoffs: HandoffSummary[] = [];

		for (let i = 0; i < spec.steps.length; i++) {
			const step = spec.steps[i];
			const stepStart = Date.now();

			try {
				// Resolve effective config (step overrides global)
				const effectiveConfig = this.getEffectiveConfig(step, spec);

				// Enrich context with previous handoffs
				const stepContext = this.enrichContextFromHandoffs(
					accumulatedContext,
					stepResults
				);

				// Execute step
				const result = await this.executeStep(effectiveConfig, stepContext);

				// Track tokens
				if (result.usage?.totalTokens) {
					totalTokens += result.usage.totalTokens;
				}

				// Generate handoff for next step
				const handoff = await this.handoffManager.generateSummary(
					this.createMinimalPacket(step, i),
					result
				);

				stepResults.push({
					step: i + 1,
					name: step.name,
					outcome: result.outcome,
					result,
					handoff,
					duration: Date.now() - stepStart,
				});

				allHandoffs.push(handoff);

				// Update accumulated context on success
				if (result.outcome === "success") {
					accumulatedContext = {
						...accumulatedContext,
						[`step_${i}_result`]: result,
						[`step_${i}_handoff`]: handoff,
					};
				} else {
					// Stop chain on step failure unless configured to continue
					if (!spec.continueOnError && !step.continueOnError) {
						break;
					}
				}

				// Emit progress event if eventsPath provided
				if (eventsPath) {
					const { appendEventAsync } = await import("../state/event-log.ts");
					await appendEventAsync(eventsPath, {
						type: "chain.step_completed",
						runId: "chain",
						taskId: `step-${i + 1}`,
						data: {
							step: i + 1,
							name: step.name,
							outcome: result.outcome,
							duration: Date.now() - stepStart,
						},
					});
				}

			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);

				stepResults.push({
					step: i + 1,
					name: step.name,
					outcome: "failure",
					duration: Date.now() - stepStart,
					error: errorMessage,
				});

				// Stop chain on failure unless configured to continue
				if (!spec.continueOnError && !step.continueOnError) {
					break;
				}
			}
		}

		return {
			steps: stepResults,
			totalDuration: Date.now() - startTime,
			success: stepResults.every(s => s.outcome !== "failure"),
			totalTokens: totalTokens > 0 ? totalTokens : undefined,
			totalHandoffs: allHandoffs,
		};
	}

	/**
	 * Parse a single step from the chain string.
	 */
	private parseStep(step: string, index: number): ChainStep {
		// Parse team reference: @teamName
		const teamMatch = step.match(/^@(\w+)/);

		// Parse workflow reference: workflow:name
		const workflowMatch = step.match(/^workflow:(\w+)/);

		// Parse template reference: template:name
		const templateMatch = step.match(/^template:(\w+)/);

		// Parse inline goal: "goal description" (can follow other patterns)
		const inlineMatch = step.match(/"([^"]+)"/);

		const name = step.split(/\s+/)[0] || `step-${index}`;

		const parsed: ChainStep = {
			name,
		};

		// Set step type based on matching pattern
		// Multiple patterns can match (e.g., @team with inline goal)
		if (teamMatch) {
			parsed.team = teamMatch[1];
		}
		if (workflowMatch) {
			parsed.workflow = workflowMatch[1];
		}
		if (templateMatch) {
			parsed.template = templateMatch[1];
		}
		if (inlineMatch) {
			parsed.inlineGoal = inlineMatch[1];
		}

		// Parse per-step overrides
		parsed.model = this.extractFlag(step, "model");
		parsed.skill = this.extractFlag(step, "skill");
		const thinkingVal = this.extractFlag(step, "thinking");
		if (thinkingVal && ["fast", "standard", "deep"].includes(thinkingVal)) {
			parsed.thinking = thinkingVal as "fast" | "standard" | "deep";
		}

		// Parse step timeout
		const timeoutStr = this.extractFlag(step, "timeout");
		if (timeoutStr) {
			const timeoutMs = parseInt(timeoutStr, 10);
			if (!isNaN(timeoutMs)) {
				parsed.timeout = timeoutMs * 1000; // Convert seconds to ms
			}
		}

		// Parse continueOnError for step
		if (this.extractFlag(step, "continue-on-error") === "true") {
			parsed.continueOnError = true;
		}

		return parsed;
	}

	/**
	 * Extract a flag from step string.
	 */
	private extractFlag(input: string, flag: string): string | undefined {
		const match = input.match(new RegExp(`--${flag}\\s+(\\S+)`));
		return match?.[1];
	}

	/**
	 * Extract a global flag from the chain string.
	 * Global flags can appear anywhere in the chain string.
	 */
	private extractGlobalFlag(input: string, flag: string): string | undefined {
		// Use explicit regex construction with string concatenation
		const patternEq = '--' + flag + '=\\s*(\\S+)';
		const match = input.match(new RegExp(patternEq, 'i'));
		if (match) return match[1];

		const patternNoEq = '--' + flag + '\\s+(\\S+)';
		const matchNoEq = input.match(new RegExp(patternNoEq, 'i'));
		if (matchNoEq) return matchNoEq[1];

		return undefined;
	}

	/**
	 * Get effective config with step overrides global.
	 */
	private getEffectiveConfig(step: ChainStep, spec: ChainSpec): ChainStep {
		return {
			...step,
			model: step.model ?? spec.globalModel,
			skill: step.skill ?? spec.globalSkill,
			thinking: step.thinking ?? spec.globalThinking,
		};
	}

	/**
	 * Enrich context with previous handoffs.
	 */
	private enrichContextFromHandoffs(
		context: Record<string, unknown>,
		previousResults: ChainStepResult[]
	): Record<string, unknown> {
		const handoffs = previousResults
			.filter(r => r.handoff)
			.map(r => r.handoff!);

		if (handoffs.length === 0) {
			return context;
		}

		return {
			...context,
			__chainHistory: handoffs.map(h => ({
				step: h.taskId,
				outcome: h.outcome,
				filesCreated: h.filesCreated,
				filesModified: h.filesModified,
				decisions: h.decisions,
				nextSteps: h.nextSteps,
			})),
		};
	}

	/**
	 * Execute a single step.
	 */
	private async executeStep(
		config: ChainStep,
		context: Record<string, unknown>
	): Promise<TaskResult> {
		const packet: TaskPacket = {
			taskId: `chain-${Date.now()}-${config.name}`,
			runId: "chain",
			goal: config.inlineGoal ?? config.name,
			summarizeThreshold: 3000,
			collapseContext: true,
			context,
		};

		return this.taskRunner.runTask(packet);
	}

	/**
	 * Create minimal packet for handoff generation.
	 */
	private createMinimalPacket(step: ChainStep, index: number): TaskPacket {
		return {
			taskId: `chain-step-${index}`,
			runId: "chain",
			goal: step.inlineGoal ?? step.name,
		};
	}
}

/**
 * Create a ChainRunner with default dependencies.
 */
export function createChainRunner(
	taskRunner: ChainTaskRunner,
	handoffManager: HandoffManager
): ChainRunner {
	return new ChainRunner(taskRunner, handoffManager);
}

/**
 * Parse chain from string shorthand.
 */
export function parseChainString(chainString: string): ChainSpec {
	const runner = new ChainRunner(
		{ runTask: () => Promise.reject(new Error("Not initialized")) } as ChainTaskRunner,
		{} as HandoffManager
	);
	return runner.parseChain(chainString);
}