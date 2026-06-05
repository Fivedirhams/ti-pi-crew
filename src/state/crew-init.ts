/**
 * Auto-initialize .crew directory structure and .gitignore entries.
 * Called on first team run in a workspace to ensure all required
 * directories and files exist.
 *
 * IMPORTANT: This module must be COMPLETELY self-contained with NO dependencies
 * on other pi-crew modules (especially paths.ts). It is called via dynamic
 * import from child-process contexts (background runners, subagents) where
 * module binding can fail. Keep this file minimal and self-contained.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { updateGitignore } from "./gitignore-manager.ts";

// Re-export updateGitignore for backwards compatibility with tests.
export { updateGitignore };

/** README content for the .crew directory. */
const CREW_README = `# .crew — pi-crew Runtime Directory

This directory contains pi-crew runtime state and artifacts.

## What's Here

| Directory | Purpose | Commit? |
|-----------|---------|---------|
| \`state/runs/\` | Run manifests, tasks, events | No |
| \`state/subagents/\` | Subagent state | No |
| \`artifacts/\` | Run outputs (test files, docs, etc.) | Optional |
| \`cache/\` | Cached run results (fingerprint-based) | No |
| \`graphs/\` | Archived run graphs | Optional |
| \`audit/\` | Security event logs | No |

## Cleanup

To prune old runs:
\`\`\`bash
team action='prune' keep=5
\`\`\`

To clear cache:
\`\`\`bash
team action='cache' action='clear'
\`\`\`
`;

/**
 * Find the project root by walking up from start directory.
 * Inline implementation to avoid module dependency on paths.ts.
 * Matches the logic in src/utils/paths.ts:computeRepoRoot().
 */
/**
 * Detect filesystem root for `start` without relying on `path.parse()`.
 *
 * **Why this exists**: This module is dynamically `import()`'d from concurrent
 * child Pi subprocesses (3+ parallel subagents). Under load, the `path` namespace
 * binding can intermittently arrive as `undefined` in jiti's ESM/CJS interop layer,
 * crashing `findProjectRoot` with `TypeError: Cannot read properties of undefined
 * (reading 'parse')` — see https://github.com/baphuongna/pi-crew/issues/28.
 *
 * Inlining `parse` for the termination root eliminates the dependency on the
 * `path` binding for that critical call path.
 */
function parseRoot(start: string): string {
	if (!start) return "/";
	if (start[0] === "/") return "/";
	// Windows: "C:\\" or "C:/" -> "C:\\"
	if (/^[A-Za-z]:[\\/]/.test(start)) return start.slice(0, 3);
	// UNC: "\\\\server\\share" — find the second path separator.
	if (start.startsWith("\\\\") || start.startsWith("//")) {
		const rest = start.slice(2);
		const firstSep = Math.max(rest.indexOf("\\"), rest.indexOf("/"));
		if (firstSep === -1) return start;
		const secondSep = Math.max(rest.indexOf("\\", firstSep + 1), rest.indexOf("/", firstSep + 1));
		if (secondSep === -1) return start;
		// secondSep is an index into `rest`; add 2 to map back to `start`.
		return start.slice(0, 2 + secondSep);
	}
	// Relative path — no fixed root, use start itself as terminator.
	return start;
}

/**
 * Defensive wrappers around `path` for use in dynamic-import contexts.
 *
 * **Why these exist**: This module is dynamically `import()`'d from concurrent
 * child Pi subprocesses (3+ parallel subagents). Under load, the `path` namespace
 * binding can intermittently arrive as `undefined` in jiti's ESM/CJS interop layer,
 * crashing `findProjectRoot` with `TypeError: Cannot read properties of undefined
 * (reading 'parse')` — see https://github.com/baphuongna/pi-crew/issues/28.
 *
 * Each helper checks that the corresponding `path` function exists before
 * calling it, falling back to an inline implementation. This keeps the file
 * self-contained even if the namespace binding is missing.
 */
function safeJoin(...parts: string[]): string {
	// Cross-platform join — picks the separator based on the parts.
	// Don't delegate to `path.join` because POSIX/Windows disagree on which
	// separator is the path separator, and the dynamic-import context (issue
	// #28) may have a partially-initialized `path` namespace.
	const sep = parts.some((p) => p.includes("\\")) ? "\\" : "/";
	// Collapse runs of the separator (e.g. "a//b" -> "a/b", "a\\b" -> "a\\b").
	const pattern = sep === "\\" ? /\\{2,}/g : /\/+/g;
	return parts.filter(Boolean).join(sep).replace(pattern, sep);
}

function safeDirname(p: string): string {
	// Cross-platform dirname — handles BOTH `/` and `\` separators.
	// Note: we don't delegate to `path.dirname` here because on POSIX it treats
	// backslashes as part of a filename, and on Windows it treats forward
	// slashes the same way. The dynamic-import context (issue #28) may also
	// have a partially-initialized `path` namespace. Using a unified inline
	// implementation ensures consistent behavior across all platforms.
	const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
	if (idx === -1) return p; // No separator at all
	if (idx === 0) return p[0] === "/" || p[0] === "\\" ? p[0] : p; // Root: "/" or "\"
	// Preserve drive letter roots like "C:\"
	if (idx === 2 && /[A-Za-z]:/.test(p.slice(0, 2))) return p.slice(0, 3);
	return p.slice(0, idx);
}

function safeResolve(p: string): string {
	if (path && typeof path.resolve === "function") return path.resolve(p);
	return p;
}

function findProjectRoot(start: string): string | undefined {
	const dirMarkers = [".git", ".hg", ".svn"];
	const fileMarkers = ["package.json", "pyproject.toml", "Cargo.toml", "go.mod"];
	// Use `parseRoot` (inlined above) to avoid `path.parse` for the critical
	// termination root — fixes the jiti namespace race in issue #28.
	const root = parseRoot(start);
	let current = safeResolve(start);
	// Walk up to find project root
	while (current !== root) {
		for (const marker of dirMarkers) {
			if (fs.existsSync(safeJoin(current, marker))) return current;
		}
		for (const marker of fileMarkers) {
			if (fs.existsSync(safeJoin(current, marker))) return current;
		}
		const parent = safeDirname(current);
		if (parent === current) break;
		current = parent;
	}
	// Check root as fallback
	if (dirMarkers.some((m) => fs.existsSync(safeJoin(root, m)))) return root;
	return undefined;
}

/**
 * Compute the crew root directory for a given working directory.
 * Matches src/utils/paths.ts:projectCrewRoot() logic.
 */
function computeCrewRoot(cwd: string): string {
	const repoRoot = findProjectRoot(cwd) ?? cwd;
	const crewDir = safeJoin(repoRoot, ".crew");
	// Keep existing .crew/ stable even when .pi/ exists for project config.
	if (fs.existsSync(crewDir)) return crewDir;
	// Legacy reuse: if .pi/ already exists, namespace under .pi/teams/
	const piDir = safeJoin(repoRoot, ".pi");
	return fs.existsSync(piDir) ? safeJoin(piDir, "teams") : crewDir;
}

/**
 * Ensure the .crew directory structure exists with all required subdirectories,
 * placeholder files, README, and .gitignore entries.
 *
 * This function is self-contained with NO dependencies on other pi-crew modules.
 * It uses inline implementations of findProjectRoot and computeCrewRoot to avoid
 * module binding issues in child-process contexts.
 */
export async function ensureCrewDirectory(cwd: string): Promise<void> {
	const crewRoot = computeCrewRoot(cwd);

	// 1. Create directory structure
	const dirs = [
		crewRoot,
		safeJoin(crewRoot, "state", "runs"),
		safeJoin(crewRoot, "state", "subagents"),
		safeJoin(crewRoot, "artifacts"),
		safeJoin(crewRoot, "cache"),
		safeJoin(crewRoot, "graphs"),
		safeJoin(crewRoot, "audit"),
	];

	for (const dir of dirs) {
		// Use mkdirSync directly with recursive:true to avoid TOCTOU race.
		// This is atomic and doesn't require existsSync check.
		fs.mkdirSync(dir, { recursive: true });
	}

	// 2. Create .gitkeep placeholders in directories that should be tracked
	const placeholders = [
		safeJoin(crewRoot, "artifacts", ".gitkeep"),
		safeJoin(crewRoot, "cache", ".gitkeep"),
		safeJoin(crewRoot, "graphs", ".gitkeep"),
		safeJoin(crewRoot, "audit", ".gitkeep"),
	];

	for (const placeholder of placeholders) {
		if (!fs.existsSync(placeholder)) {
			fs.writeFileSync(placeholder, "", "utf-8");
		}
	}

	// 3. Write README.md (always overwrite to keep it current)
	fs.writeFileSync(safeJoin(crewRoot, "README.md"), CREW_README, "utf-8");

	// 4. Update .gitignore at project root
	const repoRoot = findProjectRoot(cwd);
	if (repoRoot) {
		const gitignorePath = safeJoin(repoRoot, ".gitignore");
		await updateGitignore(gitignorePath);
	}
}

// Exported only for regression tests of issue #28.
// NOT part of the public API — the underscore prefix is a hint to bundlers
// and linters that these should not be used by application code.
export const __test_internals = {
	parseRoot,
	safeJoin,
	safeDirname,
	safeResolve,
};