/**
 * Brief tool overrides — re-registers built-in Pi tools with custom rendering.
 *
 * Inspired by oh-my-pi's pi-brief extension. Wraps each built-in tool
 * (read, bash, edit, write, find, grep, ls) keeping the original execute
 * but replacing renderCall/renderResult with themed, brief-aware versions.
 *
 * Brief mode shows CONTEXTUAL one-liners that preserve WHAT was done:
 *   read  ~/file.ts:1-50 → 142 lines · 2.3s
 *   bash  $ npm test → done · 12.5s
 *   edit  ~/file.ts → +3 -1 · 0.8s
 *   write ~/file.ts (42 lines) → ✓ · 0.2s
 *   find  *.ts in ~/src → 5 files · 0.5s
 *   grep /pattern/ in ~/src → 3 matches · 0.3s
 *   ls    ~/src → 8 entries · 0.1s
 *
 * Timing: ctx.state.startedAt is set in renderCall, read in renderResult.
 * NOTE: Pi's executionStarted is a boolean flag (NOT a timestamp).
 */

import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { isBrief } from "../../ui/tool-renderers/brief-mode.ts";

// ── Path shortening ────────────────────────────────────────────────────

const HOME = homedir();
function shortenPath(p: string): string {
	if (!p) return "";
	if (p.startsWith(HOME)) return `~${p.slice(HOME.length)}`;
	return p;
}

// ── Types ──────────────────────────────────────────────────────────────

interface TextResult {
	content: Array<{ type: string; text?: string }>;
}

interface Theme {
	fg: (slot: string, text: string) => string;
	bold: (text: string) => string;
}

interface RenderCtx {
	args?: Record<string, unknown>;
	state?: Record<string, unknown>;
}

function fullText(result: TextResult): string | undefined {
	const c = result.content.find((x): x is { type: "text"; text: string } => x.type === "text");
	return c?.text;
}

function fullRender(result: TextResult, theme: Theme): Text {
	const text = fullText(result);
	if (!text) return new Text("", 0, 0);
	const lines = text
		.trim()
		.split("\n")
		.map((line) => theme.fg("toolOutput", line))
		.join("\n");
	return new Text(`\n${lines}`, 0, 0);
}

/** Record start time in ctx.state during renderCall (called once per tool invocation). */
function noteStarted(ctx: RenderCtx | undefined): void {
	if (ctx?.state && !ctx.state.briefStartedAt) {
		ctx.state.briefStartedAt = Date.now();
	}
}

/** Compute elapsed from ctx.state.briefStartedAt. Returns " · 1.2s" or "". */
function elapsed(ctx: RenderCtx | undefined): string {
	const startedAt = ctx?.state?.briefStartedAt as number | undefined;
	if (!startedAt || typeof startedAt !== "number") return "";
	const ms = Date.now() - startedAt;
	if (ms < 1000) return "";
	if (ms < 60_000) return ` · ${(ms / 1000).toFixed(1)}s`;
	const m = Math.floor(ms / 60_000), s = Math.floor((ms % 60_000) / 1000);
	return ` · ${m}m${s}s`;
}

/** Truncate to maxLen with ellipsis (visual). */
function trunc(text: string, maxLen: number): string {
	if (text.length <= maxLen) return text;
	return text.slice(0, maxLen - 1) + "…";
}

/** Flatten multiline command to single line, truncated. */
function flatCmd(cmd: string, maxLen: number): string {
	return trunc(cmd.replace(/\s+/g, " ").trim(), maxLen);
}

// ── Tool registration ──────────────────────────────────────────────────

export function registerBriefToolOverrides(pi: ExtensionAPI, cwd: string): void {
	const tools = {
		read: createReadTool(cwd),
		bash: createBashTool(cwd),
		edit: createEditTool(cwd),
		write: createWriteTool(cwd),
		find: createFindTool(cwd),
		grep: createGrepTool(cwd),
		ls: createLsTool(cwd),
	};

	// ─── Read ───
	pi.registerTool({
		name: "read",
		label: "read",
		description: tools.read.description,
		parameters: tools.read.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.read.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any, ctx: any): any {
			noteStarted(ctx);
			const p = shortenPath(args.path || "");
			const pathDisplay = p ? theme.fg("accent", p) : theme.fg("toolOutput", "...");
			let text = `${theme.fg("toolTitle", theme.bold("read"))} ${pathDisplay}`;
			if (args.offset !== undefined || args.limit !== undefined) {
				const startLine = args.offset ?? 1;
				const endLine = args.limit !== undefined ? startLine + args.limit - 1 : "";
				text += theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
			}
			return new Text(text, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any, ctx: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const args = ctx?.args ?? {};
			const p = shortenPath(args.path || "?");
			let range = "";
			if (args.offset || args.limit) {
				const s = args.offset ?? 1;
				const e = args.limit ? s + args.limit - 1 : "";
				range = `:${s}${e ? `-${e}` : ""}`;
			}
			const text = fullText(result);
			const count = text ? text.trim().split("\n").filter(Boolean).length : 0;
			const time = elapsed(ctx);
			const label = count === 0 ? "empty" : `${count} lines`;
			return new Text(
				`${theme.fg("toolTitle", "read")} ${theme.fg("accent", p)}${theme.fg("warning", range)} ${theme.fg("dim", "→")} ${theme.fg("muted", label)}${theme.fg("dim", time)}`,
				0, 0,
			);
		},
	});

	// ─── Bash ───
	pi.registerTool({
		name: "bash",
		label: "bash",
		description: tools.bash.description,
		parameters: tools.bash.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.bash.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any, ctx: any): any {
			noteStarted(ctx);
			const command = args.command || "...";
			const timeout = args.timeout as number | undefined;
			const timeoutSuffix = timeout ? theme.fg("muted", ` (${timeout}s)`) : "";
			return new Text(theme.fg("toolTitle", theme.bold(`$ ${command}`)) + timeoutSuffix, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any, ctx: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const args = ctx?.args ?? {};
			const cmd = flatCmd(String(args.command || "?"), 50);
			const text = fullText(result);
			const time = elapsed(ctx);
			let label: string;
			let color: string;
			if (!text || !text.trim()) {
				label = "done";
				color = "muted";
			} else {
				const lines = text.trim().split("\n");
				if (lines.length === 1) {
					label = trunc(lines[0]!, 40);
					color = "muted";
				} else {
					label = `${lines.length} lines`;
					color = "muted";
				}
			}
			return new Text(
				`${theme.fg("toolTitle", "$")} ${theme.fg("accent", cmd)} ${theme.fg("dim", "→")} ${theme.fg(color, label)}${theme.fg("dim", time)}`,
				0, 0,
			);
		},
	});

	// ─── Edit ───
	pi.registerTool({
		name: "edit",
		label: "edit",
		description: tools.edit.description,
		parameters: tools.edit.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.edit.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any, ctx: any): any {
			noteStarted(ctx);
			const p = shortenPath(args.path || "");
			const pathDisplay = p ? theme.fg("accent", p) : theme.fg("toolOutput", "...");
			return new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${pathDisplay}`, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any, ctx: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const args = ctx?.args ?? {};
			const p = shortenPath(args.path || "?");
			const text = fullText(result);
			const time = elapsed(ctx);
			if (text && (text.includes("Error") || text.includes("error"))) {
				return new Text(
					`${theme.fg("toolTitle", "edit")} ${theme.fg("accent", p)} ${theme.fg("dim", "→")} ${theme.fg("error", "failed")}${theme.fg("dim", time)}`,
					0, 0,
				);
			}
			const added = text ? (text.match(/^\+ /gm) ?? []).length : 0;
			const removed = text ? (text.match(/^- /gm) ?? []).length : 0;
			if (added === 0 && removed === 0) {
				return new Text(
					`${theme.fg("toolTitle", "edit")} ${theme.fg("accent", p)} ${theme.fg("dim", "→")} ${theme.fg("success", "edited")}${theme.fg("dim", time)}`,
					0, 0,
				);
			}
			return new Text(
				`${theme.fg("toolTitle", "edit")} ${theme.fg("accent", p)} ${theme.fg("dim", "→")} ${theme.fg("toolDiffAdded", `+${added} `)}${theme.fg("toolDiffRemoved", `-${removed}`)}${theme.fg("dim", time)}`,
				0, 0,
			);
		},
	});

	// ─── Write ───
	pi.registerTool({
		name: "write",
		label: "write",
		description: tools.write.description,
		parameters: tools.write.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.write.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any, ctx: any): any {
			noteStarted(ctx);
			const p = shortenPath(args.path || "");
			const pathDisplay = p ? theme.fg("accent", p) : theme.fg("toolOutput", "...");
			const lineCount = args.content ? String(args.content).split("\n").length : 0;
			const lineInfo = lineCount > 0 ? theme.fg("muted", ` (${lineCount} lines)`) : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("write"))} ${pathDisplay}${lineInfo}`, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any, ctx: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const args = ctx?.args ?? {};
			const p = shortenPath(args.path || "?");
			const text = fullText(result);
			const time = elapsed(ctx);
			if (text) {
				return new Text(
					`${theme.fg("toolTitle", "write")} ${theme.fg("accent", p)} ${theme.fg("dim", "→")} ${theme.fg("error", trunc(text.trim().split("\n")[0] ?? "", 30))}${theme.fg("dim", time)}`,
					0, 0,
				);
			}
			return new Text(
				`${theme.fg("toolTitle", "write")} ${theme.fg("accent", p)} ${theme.fg("dim", "→")} ${theme.fg("success", "✓")}${theme.fg("dim", time)}`,
				0, 0,
			);
		},
	});

	// ─── Find ───
	pi.registerTool({
		name: "find",
		label: "find",
		description: tools.find.description,
		parameters: tools.find.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.find.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any, ctx: any): any {
			noteStarted(ctx);
			const pattern = args.pattern || "";
			const p = shortenPath(args.path || ".");
			let text = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", pattern)}`;
			text += theme.fg("toolOutput", ` in ${p}`);
			return new Text(text, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any, ctx: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const args = ctx?.args ?? {};
			const pattern = trunc(String(args.pattern || "*"), 20);
			const p = shortenPath(args.path || ".");
			const text = fullText(result);
			const count = text ? text.trim().split("\n").filter(Boolean).length : 0;
			const time = elapsed(ctx);
			const label = count === 0 ? "none" : `${count} files`;
			const color = count === 0 ? "dim" : "muted";
			return new Text(
				`${theme.fg("toolTitle", "find")} ${theme.fg("accent", pattern)} ${theme.fg("dim", `in ${p} →`)} ${theme.fg(color, label)}${theme.fg("dim", time)}`,
				0, 0,
			);
		},
	});

	// ─── Grep ───
	pi.registerTool({
		name: "grep",
		label: "grep",
		description: tools.grep.description,
		parameters: tools.grep.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.grep.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any, ctx: any): any {
			noteStarted(ctx);
			const pattern = args.pattern || "";
			const p = shortenPath(args.path || ".");
			let text = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${pattern}/`)}`;
			text += theme.fg("toolOutput", ` in ${p}`);
			return new Text(text, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any, ctx: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const args = ctx?.args ?? {};
			const pattern = trunc(String(args.pattern || "?"), 20);
			const p = shortenPath(args.path || ".");
			const text = fullText(result);
			const count = text ? text.trim().split("\n").filter(Boolean).length : 0;
			const time = elapsed(ctx);
			const label = count === 0 ? "none" : `${count} matches`;
			const color = count === 0 ? "dim" : "muted";
			return new Text(
				`${theme.fg("toolTitle", "grep")} ${theme.fg("accent", `/${pattern}/`)} ${theme.fg("dim", `in ${p} →`)} ${theme.fg(color, label)}${theme.fg("dim", time)}`,
				0, 0,
			);
		},
	});

	// ─── Ls ───
	pi.registerTool({
		name: "ls",
		label: "ls",
		description: tools.ls.description,
		parameters: tools.ls.parameters,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		async execute(toolCallId: string, params: any, signal: any, onUpdate: any, ctx: any) {
			return tools.ls.execute(toolCallId, params, signal, onUpdate);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderCall(args: any, theme: any, ctx: any): any {
			noteStarted(ctx);
			const p = shortenPath(args.path || ".");
			return new Text(`${theme.fg("toolTitle", theme.bold("ls"))} ${theme.fg("accent", p)}`, 0, 0);
		},
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		renderResult(result: any, options: any, theme: any, ctx: any): any {
			if (!isBrief() || options.expanded) return fullRender(result, theme);
			const args = ctx?.args ?? {};
			const p = shortenPath(args.path || ".");
			const text = fullText(result);
			const count = text ? text.trim().split("\n").filter(Boolean).length : 0;
			const time = elapsed(ctx);
			const label = count === 0 ? "empty" : `${count} entries`;
			const color = count === 0 ? "dim" : "muted";
			return new Text(
				`${theme.fg("toolTitle", "ls")} ${theme.fg("accent", p)} ${theme.fg("dim", "→")} ${theme.fg(color, label)}${theme.fg("dim", time)}`,
				0, 0,
			);
		},
	});
}
