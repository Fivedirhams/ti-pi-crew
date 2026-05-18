import * as fs from "node:fs";

/**
 * Read the tail of a file, capped at maxBytes.
 * If the file exceeds maxBytes, reads only the last maxBytes and snaps
 * to the nearest newline boundary to avoid partial JSONL lines.
 */
export function tailReadWithLineSnap(
	filePath: string,
	maxBytes: number,
	fallbackContent: string,
): string {
	if (!fs.existsSync(filePath)) return fallbackContent;
	const stat = fs.statSync(filePath);
	if (stat.size <= maxBytes) return fs.readFileSync(filePath, "utf-8");
	const fd = fs.openSync(filePath, "r");
	try {
		const buf = Buffer.alloc(maxBytes);
		const bytesRead = fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
		const raw = buf.slice(0, bytesRead).toString("utf-8");
		const firstNewline = raw.indexOf("\n");
		return firstNewline >= 0 ? raw.slice(firstNewline + 1) : raw;
	} finally {
		fs.closeSync(fd);
	}
}