import * as fs from "node:fs";

export interface IncrementalReadState {
	byteOffset: number;
	lineCount: number;
}

export interface IncrementalReadResult {
	lines: string[];
	state: IncrementalReadState;
	eof: boolean;
}

const CHUNK_SIZE = 64 * 1024;

/**
 * Read new lines from a text file since last known byte offset.
 * Uses fs.openSync + fs.readSync for efficient incremental reading.
 */
export function readLinesSince(filePath: string, state: IncrementalReadState): IncrementalReadResult {
	let fd: number | undefined;
	try {
		fd = fs.openSync(filePath, "r");
	} catch {
		return { lines: [], state: { byteOffset: state.byteOffset, lineCount: state.lineCount }, eof: true };
	}

	try {
		const stat = fs.fstatSync(fd);
		const fileSize = stat.size;

		if (fileSize <= state.byteOffset) {
			return {
				lines: [],
				state: { byteOffset: fileSize, lineCount: state.lineCount },
				eof: true,
			};
		}

		const bytesToRead = fileSize - state.byteOffset;
		const buf = Buffer.alloc(bytesToRead);
		let totalRead = 0;

		while (totalRead < bytesToRead) {
			const chunkSize = Math.min(CHUNK_SIZE, bytesToRead - totalRead);
			const bytesRead = fs.readSync(fd, buf, totalRead, chunkSize, state.byteOffset + totalRead);
			if (bytesRead === 0) break;
			totalRead += bytesRead;
		}

		const content = buf.toString("utf-8", 0, totalRead);
		const lines: string[] = [];
		let lineCount = state.lineCount;
		let committedOffset = state.byteOffset;

		let searchFrom = 0;
		let newlineIdx: number;

		while ((newlineIdx = content.indexOf("\n", searchFrom)) !== -1) {
			const lineText = content.slice(searchFrom, newlineIdx);
			committedOffset = state.byteOffset + newlineIdx + 1;
			searchFrom = newlineIdx + 1;
			if (lineText.length > 0) {
				lines.push(lineText);
				lineCount++;
			}
		}

		const eof = committedOffset >= fileSize;

		return {
			lines,
			state: { byteOffset: committedOffset, lineCount },
			eof,
		};
	} finally {
		if (fd !== undefined) {
			try { fs.closeSync(fd); } catch { /* ignore */ }
		}
	}
}

/**
 * Read parsed JSON objects from a JSONL file since last known byte offset.
 * Skips malformed lines.
 */
export function readJsonlSince<T>(filePath: string, state: IncrementalReadState): { items: T[]; state: IncrementalReadState; eof: boolean } {
	const result = readLinesSince(filePath, state);
	const items: T[] = [];

	for (const line of result.lines) {
		try {
			items.push(JSON.parse(line) as T);
		} catch {
			// Skip malformed lines
		}
	}

	return {
		items,
		state: result.state,
		eof: result.eof,
	};
}
