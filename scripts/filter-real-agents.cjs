const fs = require('fs');
let c = fs.readFileSync('src/ui/dashboard-panes/agents-pane.ts', 'utf8');
c = c.replace(/\r\n/g, '\n');

// Add isRealAgent helper after the TOOL_LABELS definition
const insertAfter = `const TOOL_LABELS: Record<string, string> = {`;
const helper = `/**
 * Returns true if this agent did real work (LLM call, tool use, or non-trivial duration).
 * Scaffold-only agents (no tokens, no tools, no turns) are skipped in the agents pane —
 * they represent pipeline infrastructure steps, not actual agent execution.
 */
function isRealAgent(agent: CrewAgentRecord, liveHandle?: LiveAgentHandle): boolean {
	if (agent.runtime === "live-session" || agent.runtime === "child-process") return true;
	// Scaffold agents with real work done are still worth showing
	const tokens = (agent.usage?.input ?? 0) + (agent.usage?.output ?? 0) + (agent.usage?.cacheRead ?? 0) + (agent.usage?.cacheWrite ?? 0);
	if (tokens > 0) return true;
	const turns = (agent.usage as { turns?: number } | undefined)?.turns;
	if (turns != null && turns > 0) return true;
	if ((agent.progress?.toolCount ?? 0) > 0) return true;
	// If it's still running and has been alive for > 30s, it might be real
	if (liveHandle) {
		const ms = Date.now() - liveHandle.activity.startedAtMs;
		if (ms > 30_000) return true;
	}
	return false;
}

`;
c = c.replace(insertAfter, helper + insertAfter);

// Filter agents in renderAgentsPane
const oldFilter = `for (const agent of snapshot.agents.slice(0, 12)) {`;
const newFilter = `const realAgents = snapshot.agents.filter(a => isRealAgent(a, liveForRun.find(h => h.taskId === a.taskId)));
	const lineCount = Math.min(realAgents.length, 12);
	const label = realAgents.length !== snapshot.agents.length
		? \`\${realAgents.length} real agents (\${snapshot.agents.length} total)\`
		: \`\${realAgents.length} agents\`;

	lines.push(\`\${completed}/\${total} tasks · \${label}\`);

	for (const agent of realAgents.slice(0, 12)) {`;

c = c.replace(oldFilter, newFilter);

fs.writeFileSync('src/ui/dashboard-panes/agents-pane.ts', c);
console.log('Filtered scaffold-only agents from agents pane');