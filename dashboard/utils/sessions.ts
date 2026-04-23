/**
 * Sessions utility module - Pi session management
 */

import { SessionManager } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "node:fs";

export interface SessionInfo {
	file: string;
	name: string;
	created: Date;
	messageCount: number;
	tokenCount: number;
	cost: number;
	isBookmarked: boolean;
	isCurrent: boolean;
}

export async function listSessions(cwd: string): Promise<SessionInfo[]> {
	const sessions = await SessionManager.list(cwd);
	const currentFile = SessionManager.getCurrentSessionFile?.() || "";

	return Promise.all(
		sessions.map(async (session) => {
			const stats = await getSessionStats(session.file);
			return {
				file: session.file,
				name: formatSessionName(session.file),
				created: new Date(session.mtime),
				messageCount: stats.messageCount,
				tokenCount: stats.inputTokens + stats.outputTokens,
				cost: stats.cost,
				isBookmarked: false, // TODO: implement bookmark storage
				isCurrent: session.file === currentFile,
			};
		})
	);
}

export async function getSessionStats(file: string): Promise<{
	messageCount: number;
	inputTokens: number;
	outputTokens: number;
	cost: number;
}> {
	let messageCount = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cost = 0;

	try {
		const content = readFileSync(file, "utf-8");
		const lines = content.split("\n").filter((l) => l.trim());

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === "message" && entry.message?.role === "assistant") {
					messageCount++;
					inputTokens += entry.message.usage?.input || 0;
					outputTokens += entry.message.usage?.output || 0;
					cost += entry.message.usage?.cost?.total || 0;
				}
			} catch {
				// Skip malformed entries
			}
		}
	} catch {
		// File not readable
	}

	return { messageCount, inputTokens, outputTokens, cost };
}

export function formatSessionName(file: string): string {
	// Extract session name from path
	// Format: .../sessions/<workspace>/<timestamp>_<uuid>.jsonl
	const parts = file.split("/");
	const filename = parts[parts.length - 1] || "";

	if (!filename) return "Unknown";

	// Remove extension and extract timestamp
	const withoutExt = filename.replace(/\.jsonl$/, "");
	const timestamp = withoutExt.split("_")[0];

	if (!timestamp) return withoutExt.slice(0, 30);

	// Parse timestamp (format: 2026-04-18T03-50-29-543Z)
	try {
		const formatted = timestamp
			.replace(/T/, " ")
			.replace(/-/g, ":")
			.replace(/:\d{3}Z$/, "");
		return formatted;
	} catch {
		return withoutExt.slice(0, 30);
	}
}

export function getRelativeTime(date: Date): string {
	const now = new Date();
	const diff = now.getTime() - date.getTime();
	const minutes = Math.floor(diff / 60000);
	const hours = Math.floor(diff / 3600000);
	const days = Math.floor(diff / 86400000);

	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	if (hours < 24) return `${hours}h ago`;
	if (days < 30) return `${days}d ago`;
	return date.toLocaleDateString();
}
