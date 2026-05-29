/**
 * Role-based tool configurations for pi-crew agents.
 * Uses the excludeTools option from pi v0.77.0.
 */

export interface RoleToolConfig {
	/** Explicit list of tools to use (if undefined, use all default tools) */
	tools?: string[];
	/** Tools to exclude from the default set */
	excludeTools?: string[];
}

export const ROLE_TOOL_CONFIGS: Record<string, RoleToolConfig> = {
	// Explorer - Read-only, no write or execute
	explorer: {
		tools: ["read", "grep", "find", "ls", "glob"],
		excludeTools: ["edit", "write", "bash", "web"],
	},

	// Analyst - Read and analyze, limited execution
	analyst: {
		excludeTools: ["edit", "write", "ask_question"],
	},

	// Planner - Planning and documentation
	planner: {
		excludeTools: ["ask_question"],
	},

	// Executor - Full access (default)
	executor: {
		// No restrictions - full tool access
	},

	// Reviewer - Read and review, no write
	reviewer: {
		tools: ["read", "grep", "find", "ls", "glob", "bash"],
		excludeTools: ["edit", "write"],
	},

	// Writer - Documentation focused
	writer: {
		tools: ["read", "edit", "write", "ls"],
		excludeTools: ["bash", "web", "ask_question"],
	},

	// Security Reviewer - Strict restrictions
	security_reviewer: {
		tools: ["read", "grep", "find"],
		excludeTools: ["edit", "write", "bash", "web", "ask_question"],
	},

	// Test Engineer - Can write tests
	test_engineer: {
		tools: ["read", "edit", "write", "bash", "ls"],
		excludeTools: ["web"],
	},
};

/**
 * Get tool configuration for a specific role.
 */
export function getToolConfig(role: string): RoleToolConfig {
	return ROLE_TOOL_CONFIGS[role] ?? {};
}

/**
 * Check if a role has any tool restrictions.
 */
export function hasToolRestrictions(role: string): boolean {
	const config = getToolConfig(role);
	return (config.tools !== undefined) || (config.excludeTools !== undefined);
}

/**
 * Get all restricted roles.
 */
export function getRestrictedRoles(): string[] {
	return Object.entries(ROLE_TOOL_CONFIGS)
		.filter(([, config]) => (config.tools !== undefined) || (config.excludeTools !== undefined))
		.map(([role]) => role);
}