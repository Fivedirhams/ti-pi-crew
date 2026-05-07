import { truncate } from "../utils/visual.ts";

export interface TranscriptEntry {
	id: number;
	type: "message" | "tool_call" | "tool_result" | "system";
	role?: string;
	toolName?: string;
	summary: string;
	content: string;
	expanded: boolean;
	timestamp?: number;
}

/** Extract plain text from Pi-style content (string or array of content parts). */
function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: unknown) => {
			if (!part || typeof part !== "object" || Array.isArray(part)) return "";
			const obj = part as Record<string, unknown>;
			if (typeof obj.text === "string") return obj.text;
			if (typeof obj.content === "string") return obj.content;
			if (typeof obj.name === "string") return `[tool:${obj.name}]`;
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

/** Safely cast unknown to a record for property access. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

/** Detect if an event type is a tool invocation (call/use/start). */
function isToolCallType(type: string): boolean {
	return type === "tool_call" || type === "tool_use" || type === "toolCall" || type === "tool_execution_start";
}

/** Detect if an event type is a tool response (result/end). */
function isToolResultType(type: string): boolean {
	return type === "tool_result" || type === "toolCallEnd" || type === "tool_result_end";
}

/** Extract tool name from various event shapes. */
function extractToolName(obj: Record<string, unknown>): string | undefined {
	const name =
		typeof obj.toolName === "string" ? obj.toolName :
		typeof obj.name === "string" ? obj.name :
		typeof obj.tool === "string" ? obj.tool :
		undefined;
	return name;
}

/** Create a single-line summary from text, truncating if needed. */
function summarize(text: string, maxLength: number): string {
	const oneLine = text.replace(/\r?\n/g, " ").trim();
	if (oneLine.length <= maxLength) return oneLine;
	return oneLine.slice(0, maxLength - 1) + "…";
}

const SUMMARY_MAX = 120;

/** Parse raw JSONL lines into TranscriptEntry[].
 *
 * Grouping rules:
 * - tool_call events are grouped with their subsequent tool_result into one entry.
 * - message events (message_end, etc.) become their own entry.
 * - Everything else becomes a system entry.
 */
export function parseTranscriptEntries(lines: string[]): TranscriptEntry[] {
	const entries: TranscriptEntry[] = [];
	let id = 0;

	// Pre-parse valid JSON lines
	const parsed: Array<{ raw: string; obj: Record<string, unknown> }> = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			const json: unknown = JSON.parse(trimmed);
			const obj = asRecord(json);
			if (obj) parsed.push({ raw: trimmed, obj });
		} catch {
			// Non-JSON line → treat as a system entry
			entries.push({
				id: id++,
				type: "system",
				summary: summarize(trimmed, SUMMARY_MAX),
				content: trimmed,
				expanded: false,
			});
		}
	}

	let i = 0;
	while (i < parsed.length) {
		const { obj } = parsed[i]!;
		const type = typeof obj.type === "string" ? obj.type : "";
		const timestamp = typeof obj.timestamp === "number" ? obj.timestamp : undefined;

		if (isToolCallType(type)) {
			// Look ahead for matching tool_result
			const toolName = extractToolName(obj) ?? "unknown";
			const inputText =
				typeof obj.input === "string" ? obj.input :
				obj.input !== undefined ? JSON.stringify(obj.input) : "";
			let resultText = "";
			let isError = false;
			let resultTimestamp = timestamp;

			// Consume consecutive tool_result lines
			let j = i + 1;
			while (j < parsed.length) {
				const nextTypeVal = parsed[j]!.obj.type;
				const nextType = typeof nextTypeVal === "string" ? nextTypeVal : "";
				if (isToolResultType(nextType) || /tool/i.test(nextType)) {
					const robj = parsed[j]!.obj;
					const rt =
						typeof robj.text === "string" ? robj.text :
						typeof robj.result === "string" ? robj.result :
						robj.result !== undefined ? JSON.stringify(robj.result) : "";
					resultText = rt;
					isError = robj.isError === true;
					resultTimestamp = typeof robj.timestamp === "number" ? robj.timestamp : resultTimestamp;
					j++;
					break;
				}
				if (isToolCallType(nextType)) break; // next tool call, stop looking
				j++;
			}

			const callSummary = summarize(`🔧 ${toolName}${inputText ? ": " + summarize(inputText, 60) : ""}`, SUMMARY_MAX);
			const callContent = [
				`[Tool Call: ${toolName}]`,
				inputText || "(no input)",
				`[Result${isError ? " ✗" : " ✓"}]`,
				resultText || "(no output)",
			].join("\n");

			entries.push({
				id: id++,
				type: "tool_call",
				toolName,
				summary: callSummary,
				content: callContent,
				expanded: false,
				timestamp: resultTimestamp ?? timestamp,
			});
			i = j;
			continue;
		}

		if (isToolResultType(type) || /tool/i.test(type)) {
			// Standalone tool result (no preceding tool_call consumed it)
			const toolName = extractToolName(obj) ?? "unknown";
			const isError = obj.isError === true;
			const text =
				typeof obj.text === "string" ? obj.text :
				typeof obj.result === "string" ? obj.result :
				obj.result !== undefined ? JSON.stringify(obj.result) : "";

			const summary = summarize(`${isError ? "✗" : "✓"} ${toolName}${text ? ": " + summarize(text, 60) : ""}`, SUMMARY_MAX);
			const content = [
				`[Tool Result: ${toolName}${isError ? " (error)" : ""}]`,
				text || "(no output)",
			].join("\n");

			entries.push({
				id: id++,
				type: "tool_result",
				toolName,
				summary,
				content,
				expanded: false,
				timestamp,
			});
			i++;
			continue;
		}

		// Message events (message_end, message_start, etc.)
		const message = asRecord(obj.message);
		if (message || type.startsWith("message")) {
			const msg = message ?? obj;
			const role = typeof msg.role === "string" ? msg.role : "unknown";
			const text = textFromContent(msg.content);

			const label = role === "assistant" ? "🤖" : role === "user" ? "👤" : "💬";
			const summary = summarize(`${label} ${role}${text ? ": " + summarize(text, 80) : ""}`, SUMMARY_MAX);
			const content = `[${role.charAt(0).toUpperCase()}${role.slice(1)}]:\n${text || "(empty)"}`;

			entries.push({
				id: id++,
				type: "message",
				role,
				summary,
				content,
				expanded: false,
				timestamp,
			});
			i++;
			continue;
		}

		// Everything else → system entry
		const text = textFromContent(obj.content) || (typeof obj.text === "string" ? obj.text : "");
		const displayText = text || type || JSON.stringify(obj);
		entries.push({
			id: id++,
			type: "system",
			summary: summarize(`⚙ ${type ? `[${type}]` : ""} ${summarize(displayText, 80)}`, SUMMARY_MAX),
			content: displayText,
			expanded: false,
			timestamp,
		});
		i++;
	}

	return entries;
}

/** Toggle expand/collapse for an entry by index. Returns a new array. */
export function toggleEntry(entries: TranscriptEntry[], index: number): TranscriptEntry[] {
	return entries.map((entry, i) =>
		i === index ? { ...entry, expanded: !entry.expanded } : entry,
	);
}

/** Render entries into display lines, respecting expand/collapse.
 *  Collapsed entries produce 1 line (summary). Expanded entries produce multi-line content.
 *  Every line is truncated to maxWidth.
 */
export function renderEntries(entries: TranscriptEntry[], maxWidth: number): string[] {
	const effectiveWidth = Math.max(1, maxWidth);
	const lines: string[] = [];

	for (const entry of entries) {
		if (entry.expanded) {
			const contentLines = entry.content.split(/\r?\n/);
			if (contentLines.length === 0 || (contentLines.length === 1 && contentLines[0] === "")) {
				lines.push(truncate(`▸ ${entry.summary}`, effectiveWidth));
			} else {
				lines.push(truncate(`▾ ${entry.summary}`, effectiveWidth));
				for (const line of contentLines) {
					lines.push(truncate(`  ${line}`, effectiveWidth));
				}
			}
		} else {
			lines.push(truncate(`▸ ${entry.summary}`, effectiveWidth));
		}
	}

	return lines;
}
