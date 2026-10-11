/** Session listing, filtering, persistent bookmarks, and safe deferred switching. */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { listSessions, getRelativeTime, type SessionInfo } from "../utils/sessions.js";
import { toggleBookmark } from "../utils/bookmarks.js";
import { selectItem, inputText } from "../utils/select.js";

export class SessionPanel {
	#sessions: SessionInfo[] = [];
	#filter = "";
	#loading = false;
	#error: string | undefined;
	#disposed = false;
	#abort = new AbortController();
	constructor(private ctx: ExtensionContext, private changed: () => void, private switchTo: (file: string) => void) {}
	dispose(): void { this.#disposed = true; this.#abort.abort(); }
	async refresh(): Promise<void> {
		if (this.#loading || this.#disposed) return;
		this.#loading = true; this.#error = undefined; this.changed();
		try {
			this.#sessions = await listSessions(this.ctx.cwd, this.ctx.sessionManager.getSessionFile(), this.ctx.sessionManager.getSessionDir(), this.#abort.signal);
			this.#sessions.sort((a, b) => Number(b.isBookmarked) - Number(a.isBookmarked) || b.created.getTime() - a.created.getTime());
		} catch (error) { this.#error = error instanceof Error ? error.message : String(error); }
		finally { this.#loading = false; if (!this.#disposed) this.changed(); }
	}
	#filtered(): SessionInfo[] {
		const query = this.#filter.toLocaleLowerCase();
		return this.#sessions.filter(s => `${s.name} ${s.preview} ${s.file}`.toLocaleLowerCase().includes(query));
	}
	async handleAction(action: string): Promise<void> {
		if (action === "menu") {
			const selected = await selectItem(this.ctx, "Session Actions", [
				{ value: "switch", label: "Switch session" }, { value: "switch_new", label: "Open in new terminal" },
				{ value: "bookmark", label: "Toggle bookmark" }, { value: "filter", label: "Filter sessions" },
				{ value: "refresh", label: "Refresh sessions" },
			]);
			if (selected) await this.handleAction(selected);
			return;
		}
		if (action === "refresh") { await this.refresh(); return; }
		if (action === "filter") {
			const filter = await inputText(this.ctx, "Filter by session name or first message (empty clears):", this.#filter);
			if (filter !== undefined) { this.#filter = filter.trim(); this.changed(); }
			return;
		}
		const selected = await selectItem(this.ctx, action === "bookmark" ? "Toggle Session Bookmark" : "Select Session", this.#filtered().map(s => ({
			value: s.file, label: `${s.isCurrent ? "● " : ""}${s.isBookmarked ? "★ " : ""}${s.name}`,
			description: `${getRelativeTime(s.created)} · ${s.messageCount} msgs · ${s.preview.replace(/\s+/g, " ").slice(0, 80)}`,
		})));
		if (!selected || this.#disposed) return;
		if (action === "bookmark") {
			await toggleBookmark(selected);
			await this.refresh();
			return;
		}
		if (action === "switch_new") {
			// TERMINAL is an executable name/path, not a shell command string.
			const child = spawn(process.env.TERMINAL || "alacritty", ["-e", "pi", "--session", selected], { detached: true, stdio: "ignore" });
			child.once("error", () => { if (!this.#disposed) this.ctx.ui.notify("Could not launch terminal", "error"); });
			child.unref(); return;
		}
		if (this.#sessions.find(s => s.file === selected)?.isCurrent) { this.ctx.ui.notify("Already in this session", "info"); return; }
		// Close the custom screen first; openDashboard switches after the UI promise resolves.
		this.switchTo(selected);
	}
	render(theme: Theme, _width: number): string[] {
		if (this.#loading) return ["", "  Loading sessions...", ""];
		if (this.#error) return ["", `  Sessions error: ${this.#error}`, "  Press R to retry."];
		const sessions = this.#filtered();
		const lines = [`  ${theme.bold(theme.fg("accent", "Sessions"))} ${sessions.length}/${this.#sessions.length} (this repo)`];
		if (this.#filter) lines.push(`  Filter: ${this.#filter} (F to change/clear)`);
		lines.push(`  Total: ${sessions.reduce((n, s) => n + s.tokenCount, 0).toLocaleString()} tokens · $${sessions.reduce((n, s) => n + s.cost, 0).toFixed(3)}`, "");
		if (!sessions.length) lines.push(this.#filter ? "  No sessions match this filter" : "  No sessions found");
		for (const s of sessions.slice(0, 8)) {
			lines.push(`  ${s.isCurrent ? "●" : " "} ${s.isBookmarked ? "★" : " "} ${s.name}`);
			lines.push(theme.fg("dim", `      ${getRelativeTime(s.created)} · ${s.messageCount} msgs · ${s.tokenCount.toLocaleString()} tokens`));
		}
		if (sessions.length > 8) lines.push(theme.fg("dim", `  …${sessions.length - 8} more — S to select from all`));
		return lines;
	}
}
