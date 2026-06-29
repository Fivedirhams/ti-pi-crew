/**
 * Task status utilities for piOps
 * Standalone module - no runtime dependencies to avoid circular imports
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type TaskStatus = "todo" | "in_progress" | "completed" | "failed" | "cancelled";

/**
 * Update task status in piOps index.json
 * Called by task-runner when task status changes
 */
export async function updateTaskStatus(taskId: string, newStatus: TaskStatus, stage?: string): Promise<void> {
	if (!taskId) return;
	
	const piOpsDir = path.join(os.homedir(), '.pi', 'agent', 'piops');
	const indexPath = path.join(piOpsDir, 'index.json');
	
	try {
		if (!fs.existsSync(indexPath)) {
			console.log('[piOps] No index.json to update');
			return;
		}
		
		const indexData = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
		
		if (!indexData.tasks || !indexData.tasks[taskId]) {
			console.log(`[piOps] Task ${taskId} not found in index`);
			return;
		}
		
		const oldStatus = indexData.tasks[taskId].status;
		indexData.tasks[taskId].status = newStatus;
		indexData.tasks[taskId].stage = stage || null;
		indexData.tasks[taskId].updated_at = new Date().toISOString();
		
		fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
		console.log(`[piOps] Updated task ${taskId}: ${oldStatus} → ${newStatus}${stage ? ` (stage: ${stage})` : ''}`);
		
		// Also update task document
		const docsDir = path.join(os.homedir(), '.pi', 'agent', 'docs', 'tasks');
		const taskDocPath = path.join(docsDir, `${taskId}.md`);
		if (fs.existsSync(taskDocPath)) {
			let docContent = fs.readFileSync(taskDocPath, 'utf-8');
			docContent = docContent.replace(/## Status\n.*\n/, `## Status\n${newStatus}\n`);
			fs.writeFileSync(taskDocPath, docContent);
		}
	} catch (e) {
		console.log('[piOps] Could not update task status:', e);
	}
}
