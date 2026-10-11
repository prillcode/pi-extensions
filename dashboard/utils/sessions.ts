/** Pi 1.x session metadata and non-blocking, bounded session usage scans. */
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename } from "node:path";
import { loadBookmarks } from "./bookmarks.js";

export interface SessionInfo {
	file: string;
	name: string;
	preview: string;
	created: Date;
	messageCount: number;
	tokenCount: number;
	cost: number;
	isBookmarked: boolean;
	isCurrent: boolean;
}
type Stats = { messageCount: number; inputTokens: number; outputTokens: number; cost: number };
const cache = new Map<string, { version: string; stats: Stats }>();
export async function listSessions(cwd: string, currentFile?: string, sessionDir?: string, signal?: AbortSignal): Promise<SessionInfo[]> {
	const [sessions, bookmarks] = await Promise.all([
		SessionManager.list(cwd, sessionDir, undefined, signal), loadBookmarks(),
	]);
	const results: SessionInfo[] = new Array(sessions.length);
	let next = 0;
	// At most four session streams at a time, not one readFileSync per session.
	await Promise.all(Array.from({ length: Math.min(4, sessions.length) }, async () => {
		while (next < sessions.length) {
			signal?.throwIfAborted();
			const index = next++, session = sessions[index]!;
			const stats = await getSessionStats(session.path, signal);
			results[index] = {
				file: session.path, name: session.name || formatSessionName(session.path),
				preview: session.firstMessage, created: session.modified,
				messageCount: session.messageCount, tokenCount: stats.inputTokens + stats.outputTokens,
				cost: stats.cost, isBookmarked: bookmarks.has(session.path), isCurrent: session.path === currentFile,
			};
		}
	}));
	return results;
}
export async function getSessionStats(file: string, signal?: AbortSignal): Promise<Stats> {
	const stats: Stats = { messageCount: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
	let version: string;
	try {
		const metadata = await stat(file);
		version = metadata.mtimeMs + ":" + metadata.size;
	} catch { return stats; }
	const cached = cache.get(file);
	if (cached?.version === version) return cached.stats;
	const stream = createReadStream(file, { encoding: "utf8", signal });
	const lines = createInterface({ input: stream, crlfDelay: Infinity });
	try {
		let count = 0;
		for await (const line of lines) {
			signal?.throwIfAborted();
			try {
				const entry = JSON.parse(line);
				if (entry.type === "message" && entry.message?.role === "assistant") {
					stats.messageCount++;
					stats.inputTokens += entry.message.usage?.input || 0;
					stats.outputTokens += entry.message.usage?.output || 0;
					stats.cost += entry.message.usage?.cost?.total || 0;
				}
			} catch { /* Ignore incomplete trailing records and malformed entries. */ }
			if (++count % 100 === 0) await new Promise<void>(resolve => setImmediate(resolve));
		}
	} finally { lines.close(); stream.destroy(); }
	if (cache.size >= 256) cache.delete(cache.keys().next().value!);
	cache.set(file, { version, stats });
	return stats;
}
export function formatSessionName(file: string): string {
	const timestamp = basename(file, ".jsonl").split("_")[0] || "Unknown";
	return timestamp.replace(/T(\d{2})-(\d{2})-(\d{2})-\d{3}Z$/, " $1:$2:$3 UTC");
}
export function getRelativeTime(date: Date): string {
	const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
	if (minutes < 1) return "just now";
	if (minutes < 60) return minutes + "m ago";
	if (minutes < 1440) return Math.floor(minutes / 60) + "h ago";
	if (minutes < 43200) return Math.floor(minutes / 1440) + "d ago";
	return date.toLocaleDateString();
}
