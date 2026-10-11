/** Session bookmarks are user state, not transcript entries or repo content. */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export const bookmarksPath = () => join(getAgentDir(), "dashboard-bookmarks.json");
export async function loadBookmarks(path = bookmarksPath()): Promise<Set<string>> {
	try {
		const data: unknown = JSON.parse(await readFile(path, "utf8"));
		if (!Array.isArray(data) || !data.every(item => typeof item === "string")) throw new Error("Invalid dashboard bookmarks file");
		return new Set(data);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
		throw error; // Never silently overwrite corrupt or unreadable user state.
	}
}
let writes: Promise<unknown> = Promise.resolve();
export function toggleBookmark(file: string, path = bookmarksPath()): Promise<boolean> {
	const operation = writes.catch(() => {}).then(async () => {
		const bookmarks = await loadBookmarks(path);
		const enabled = !bookmarks.has(file);
		if (enabled) bookmarks.add(file); else bookmarks.delete(file);
		await mkdir(dirname(path), { recursive: true });
		const temp = path + "." + randomUUID() + ".tmp";
		try {
			await writeFile(temp, JSON.stringify([...bookmarks], null, 2) + "\n", { mode: 0o600 });
			await rename(temp, path);
		} finally { await unlink(temp).catch(() => {}); }
		return enabled;
	});
	writes = operation;
	return operation;
}
