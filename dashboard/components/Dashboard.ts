/**
 * Dashboard Component - Main dashboard UI
 *
 * Tabs: 1:Tasks  2:Sessions  3:Git  4:OmniRoute  5:Info
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext, ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { selectItem, inputText, confirmItem } from "../utils/select.js";
import { formatTokens } from "../utils/format.js";
import type { TodoItem, DashboardTab } from "../types.js";
import { GitPanel } from "./GitPanel.js";
import { SessionPanel } from "./SessionPanel.js";
import { OmniRoutePanel } from "./OmniRoutePanel.js";

const TABS: { key: DashboardTab; label: string; shortcut: string }[] = [
	{ key: "tasks", label: "Tasks", shortcut: "1" },
	{ key: "sessions", label: "Sessions", shortcut: "2" },
	{ key: "git", label: "Git", shortcut: "3" },
	{ key: "omniroute", label: "OmniRoute", shortcut: "4" },
	{ key: "info", label: "Info", shortcut: "5" },
];

export class DashboardComponent {
	#ctx: ExtensionContext;
	#onClose: () => void;
	#tui: { requestRender: () => void; terminal?: { rows: number } };
	#disposed = false;
	#busy = false;
	#scroll = 0;
	#cachedHeight = 0;
	#todos: TodoItem[];
	#selectedTab: DashboardTab = "tasks";
	#showHelp = false;
	#taskCursor = 0;
	#cachedLines: string[] = [];
	#cachedWidth = 0;
	#gitPanel: GitPanel;
	#sessionPanel: SessionPanel;
	#omniroutePanel: OmniRoutePanel;
	#saveTodos: () => void;

	constructor(
		tui: { requestRender: () => void; terminal?: { rows: number } },
		ctx: ExtensionContext,
		_pi: ExtensionAPI,
		onClose: () => void,
		todos: TodoItem[],
		saveTodos: () => void,
		onSwitchSession: (file: string) => void = () => ctx.ui.notify("Use /resume to switch sessions from shortcut context", "info"),
	) {
		this.#tui = tui;
		this.#ctx = ctx;
		this.#onClose = () => { this.dispose(); onClose(); };
		this.#todos = todos;
		this.#saveTodos = saveTodos;
		this.#gitPanel = new GitPanel(ctx, () => {
			this.invalidate();
			this.#tui.requestRender();
		});
		this.#sessionPanel = new SessionPanel(ctx, () => {
			this.invalidate();
			this.#tui.requestRender();
		}, onSwitchSession);
		this.#omniroutePanel = new OmniRoutePanel(ctx, () => {
			this.invalidate();
			this.#tui.requestRender();
		});
	}

	get #tabIndex(): number {
		return TABS.findIndex((t) => t.key === this.#selectedTab);
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#gitPanel.dispose(); this.#sessionPanel.dispose(); this.#omniroutePanel.dispose();
	}

	#runAction(action: () => Promise<void>): void {
		if (this.#busy || this.#disposed) return;
		this.#busy = true;
		void action().catch(error => {
			if (!this.#disposed) this.#ctx.ui.notify(error instanceof Error ? error.message : "Dashboard action failed", "error");
		}).finally(() => { this.#busy = false; });
	}

	handleInput(data: string): void {
		if (this.#disposed || this.#busy) return;
		if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.pageUp)) {
			this.#scroll = Math.max(0, this.#scroll + (matchesKey(data, Key.pageDown) ? 10 : -10));
			this.invalidate(); this.#tui.requestRender(); return;
		}
		if (data === "?") {
			this.#showHelp = !this.#showHelp;
			this.invalidate();
			this.#tui.requestRender();
			return;
		}

		if (this.#showHelp) {
			this.#showHelp = false;
			this.invalidate();
			this.#tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.escape) || data === "q" || data === "Q") {
			this.#onClose();
			return;
		}

		if (matchesKey(data, Key.right)) {
			const next = (this.#tabIndex + 1) % TABS.length;
			this.#switchTab(TABS[next]!.key);
			return;
		}
		if (matchesKey(data, Key.left)) {
			const prev = (this.#tabIndex - 1 + TABS.length) % TABS.length;
			this.#switchTab(TABS[prev]!.key);
			return;
		}

		if (data === "1") return this.#switchTab("tasks");
		if (data === "2") return this.#switchTab("sessions");
		if (data === "3") return this.#switchTab("git");
		if (data === "4") return this.#switchTab("omniroute");
		if (data === "5") return this.#switchTab("info");

		// Tab-specific actions
		// M = menu on any tab
		if (data === "m" || data === "M") {
			if (this.#selectedTab === "tasks") {
				this.#runAction(() => this.#tasksMenu());
			} else if (this.#selectedTab === "sessions") {
				this.#runAction(() => this.#sessionPanel.handleAction("menu"));
			} else if (this.#selectedTab === "git") {
				this.#runAction(() => this.#gitPanel.handleAction("menu"));
			}
			return;
		}

		if (this.#selectedTab === "tasks") {
			if (matchesKey(data, Key.up)) {
				this.#moveTaskCursor(-1);
				return;
			}
			if (matchesKey(data, Key.down)) {
				this.#moveTaskCursor(1);
				return;
			}
			if (matchesKey(data, Key.space) || matchesKey(data, Key.enter)) {
				this.#toggleTaskAtCursor();
				return;
			}
			if (data === "a" || data === "A") {
				this.#runAction(() => this.#addTask());
				return;
			}
			if (data === "e" || data === "E") {
				this.#runAction(() => this.#editTaskAtCursor());
				return;
			}
			if (data === "x" || data === "X") {
				this.#runAction(() => this.#deleteTaskAtCursor());
				return;
			}
			if (data === "j" || data === "J") {
				this.#moveTaskAtCursor(1);
				return;
			}
			if (data === "k" || data === "K") {
				this.#moveTaskAtCursor(-1);
				return;
			}
		} else if (this.#selectedTab === "git") {
			if (data === "c" || data === "C") this.#runAction(() => this.#gitPanel.handleAction("checkout"));
			else if (data === "n" || data === "N") this.#runAction(() => this.#gitPanel.handleAction("create"));
			else if (data === "d" || data === "D") this.#runAction(() => this.#gitPanel.handleAction("delete"));
			else if (data === "s" || data === "S") this.#runAction(() => this.#gitPanel.handleAction("stage"));
			else if (data === "u" || data === "U") this.#runAction(() => this.#gitPanel.handleAction("unstage"));
			else if (data === "r" || data === "R") void this.#gitPanel.refresh();
		} else if (this.#selectedTab === "sessions") {
			if (data === "s" || data === "S") this.#runAction(() => this.#sessionPanel.handleAction("switch"));
			else if (data === "b" || data === "B") this.#runAction(() => this.#sessionPanel.handleAction("bookmark"));
			else if (data === "f" || data === "F") this.#runAction(() => this.#sessionPanel.handleAction("filter"));
			else if (data === "r" || data === "R") void this.#sessionPanel.refresh();
		} else if (this.#selectedTab === "omniroute") {
			if (data === "r" || data === "R") void this.#omniroutePanel.refresh();
			else if (data === "d" || data === "D") this.#omniroutePanel.toggleDetails();
		}
	}

	#switchTab(tab: DashboardTab): void {
		this.#selectedTab = tab;
		this.#scroll = 0;
		if (tab === "git") void this.#gitPanel.refresh();
		if (tab === "sessions") void this.#sessionPanel.refresh();
		this.#omniroutePanel.setActive(tab === "omniroute");
		this.invalidate();
		this.#tui.requestRender();
	}

	// ========================================================================
	// Tasks helpers
	// ========================================================================

	async #tasksMenu(): Promise<void> {
		const result = await selectItem(this.#ctx, "Task Actions", [
			{ value: "add", label: "Add task" }, { value: "edit", label: "Edit selected task" },
			{ value: "toggle", label: "Toggle selected task" }, { value: "delete", label: "Delete selected task" },
			{ value: "up", label: "Move selected task up" }, { value: "down", label: "Move selected task down" },
		]);
		if (result === "add") await this.#addTask();
		else if (result === "edit") await this.#editTaskAtCursor();
		else if (result === "toggle") this.#toggleTaskAtCursor();
		else if (result === "delete") await this.#deleteTaskAtCursor();
		else if (result === "up") this.#moveTaskAtCursor(-1);
		else if (result === "down") this.#moveTaskAtCursor(1);
	}

	async #addTask(): Promise<void> {
		try {
			const text = await inputText(this.#ctx, "New task:", "");
			if (!text?.trim()) return;
			if (this.#disposed) return;
			this.#todos.push({ id: crypto.randomUUID(), text: text.trim(), done: false });
			this.#taskCursor = this.#todos.length - 1;
			this.#saveTodos();
			this.invalidate();
			this.#tui.requestRender();
			this.#ctx.ui.notify(`Task added: ${text.trim()}`, "info");
		} catch (error) {
			this.#ctx.ui.notify(`Failed to add task: ${error}`, "error");
		}
	}

	#clampTaskCursor(): void {
		if (this.#todos.length === 0) {
			this.#taskCursor = 0;
			return;
		}
		this.#taskCursor = Math.max(0, Math.min(this.#todos.length - 1, this.#taskCursor));
	}

	#moveTaskCursor(delta: number): void {
		if (this.#todos.length === 0) return;
		this.#taskCursor = Math.max(0, Math.min(this.#todos.length - 1, this.#taskCursor + delta));
		this.invalidate();
		this.#tui.requestRender();
	}

	#toggleTaskAtCursor(): void {
		const todo = this.#todos[this.#taskCursor];
		if (!todo) return;
		todo.done = !todo.done;
		this.#saveTodos();
		this.invalidate();
		this.#tui.requestRender();
	}

	async #editTaskAtCursor(): Promise<void> {
		const todo = this.#todos[this.#taskCursor];
		if (!todo) return;
		const text = await inputText(this.#ctx, "Edit task:", todo.text);
		const trimmed = text?.trim();
		if (!trimmed || this.#disposed) return;
		todo.text = trimmed;
		this.#saveTodos();
		this.invalidate();
		this.#tui.requestRender();
	}

	async #deleteTaskAtCursor(): Promise<void> {
		const todo = this.#todos[this.#taskCursor];
		if (!todo) return;
		const ok = await confirmItem(this.#ctx, "Delete task?", todo.text);
		if (!ok || this.#disposed) return;
		const index = this.#todos.indexOf(todo);
		if (index < 0) return;
		this.#todos.splice(index, 1);
		this.#clampTaskCursor();
		this.#saveTodos();
		this.invalidate();
		this.#tui.requestRender();
	}

	#moveTaskAtCursor(delta: number): void {
		const index = this.#taskCursor;
		const target = index + delta;
		if (index < 0 || index >= this.#todos.length) return;
		if (target < 0 || target >= this.#todos.length) return;
		const [todo] = this.#todos.splice(index, 1);
		this.#todos.splice(target, 0, todo!);
		this.#taskCursor = target;
		this.#saveTodos();
		this.invalidate();
		this.#tui.requestRender();
	}

	invalidate(): void {
		this.#cachedWidth = 0;
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		if (width === this.#cachedWidth && (this.#tui.terminal?.rows ?? 40) === this.#cachedHeight && this.#cachedLines.length > 0) {
			return this.#cachedLines;
		}

		const theme = this.#ctx.ui.theme;
		const lines: string[] = [];
		const dim = (s: string) => theme.fg("dim", s);

		lines.push(this.#renderHeader(theme, width));
		lines.push(this.#renderTabBar(theme, width));
		lines.push(dim("─".repeat(width)));

		if (this.#showHelp) {
			lines.push(...this.#renderHelp(theme, width));
		} else {
			switch (this.#selectedTab) {
				case "tasks":
					lines.push(...this.#renderTasks(width));
					break;
				case "sessions":
					lines.push(...this.#sessionPanel.render(theme, width));
					break;
				case "git":
					lines.push(...this.#gitPanel.render(theme, width));
					break;
				case "omniroute":
					lines.push(...this.#omniroutePanel.render(theme, width));
					break;
				case "info":
					lines.push(...this.#renderInfo(width));
					break;
			}
		}

		lines.push(dim("─".repeat(width)));
		lines.push(this.#renderFooter(theme, width));

		const body = lines.slice(3, -2);
		const maxBody = Math.max(3, (this.#tui.terminal?.rows ?? 40) - 5);
		if (this.#selectedTab === "tasks" && !this.#showHelp) {
			const cursorLine = this.#taskCursor + 2;
			if (cursorLine < this.#scroll) this.#scroll = cursorLine;
			if (cursorLine >= this.#scroll + maxBody) this.#scroll = cursorLine - maxBody + 1;
		}
		this.#scroll = Math.min(this.#scroll, Math.max(0, body.length - maxBody));
		const viewport = [...lines.slice(0, 3), ...body.slice(this.#scroll, this.#scroll + maxBody), ...lines.slice(-2)];
		if (body.length > maxBody) viewport[viewport.length - 1] = ` PgUp/PgDn scroll · ${this.#scroll + 1}-${Math.min(body.length, this.#scroll + maxBody)}/${body.length} · Q close` ;
		this.#cachedLines = viewport.map(line => truncateToWidth(line, width));
		this.#cachedWidth = width;
		this.#cachedHeight = this.#tui.terminal?.rows ?? 40;
		return this.#cachedLines;
	}

	#renderHeader(theme: Theme, width: number): string {
		const title = ` ${theme.bold(theme.fg("accent", "π Dashboard"))} `;
		return this.#centerLine(title, width);
	}

	#renderTabBar(theme: Theme, width: number): string {
		const tabParts = TABS.map((tab) => {
			const isActive = this.#selectedTab === tab.key;
			if (isActive) {
				return theme.bold(theme.fg("accent", ` ${tab.shortcut}:${tab.label} `));
			}
			return theme.fg("dim", ` ${tab.shortcut}:${tab.label} `);
		});
		const separator = theme.fg("dim", "│");
		const bar = tabParts.join(separator);
		return this.#centerLine(bar, width);
	}

	#renderFooter(theme: Theme, width: number): string {
		const dim = (s: string) => theme.fg("dim", s);

		if (this.#showHelp) {
			return this.#centerLine(dim("Any key to close help"), width);
		}

		const hints: Record<string, string> = {
			tasks: "↑↓ select • Space toggle • A add • E edit • X del • J/K move • ? help • Q close",
			sessions: "S switch • B bookmark • F filter • M menu • ? help • Q close",
			git: "C checkout • N new • D delete • S stage • U unstage • R refresh • M menu",
			omniroute: "R refresh • D details • PgUp/PgDn scroll • ? help • Q close",
			info: "←→ tabs • ? help • Q close",
		};

		return this.#centerLine(dim(hints[this.#selectedTab] ?? ""), width);
	}

	// ========================================================================
	// Tab: Tasks (1)
	// ========================================================================

	#renderTasks(width: number): string[] {
		const theme = this.#ctx.ui.theme;
		const lines: string[] = [];
		const accent = (s: string) => theme.fg("accent", s);
		const muted = (s: string) => theme.fg("muted", s);
		const dim = (s: string) => theme.fg("dim", s);
		const success = (s: string) => theme.fg("success", s);
		const bold = (s: string) => theme.bold(s);

		if (this.#todos.length === 0) {
			lines.push("");
			lines.push(dim("  No tasks yet. Press A or use /task to add items."));
			return lines;
		}

		this.#clampTaskCursor();
		const doneCount = this.#todos.filter((t) => t.done).length;
		lines.push(`  ${bold(accent("Tasks"))} ${dim("(")}${success(String(doneCount))}${dim("/")}${muted(String(this.#todos.length))}${dim(" completed)")}`);
		lines.push("");

		for (let i = 0; i < this.#todos.length; i++) {
			const todo = this.#todos[i]!;
			const isCursor = i === this.#taskCursor;
			const checkbox = todo.done ? success("✓") : dim("○");
			const text = todo.done ? muted(todo.text) : todo.text;
			const pointer = isCursor ? accent("▸") : " ";
			lines.push(`    ${pointer} ${checkbox} ${text}`);
		}

		return lines;
	}

	// ========================================================================
	// Tab: Info (5) — merged session + model + stats
	// ========================================================================

	#renderInfo(width: number): string[] {
		const theme = this.#ctx.ui.theme;
		const lines: string[] = [];
		const accent = (s: string) => theme.fg("accent", s);
		const muted = (s: string) => theme.fg("muted", s);
		const dim = (s: string) => theme.fg("dim", s);
		const success = (s: string) => theme.fg("success", s);
		const bold = (s: string) => theme.bold(s);

		// Session info
		const sessionFile = this.#ctx.sessionManager.getSessionFile() ?? "ephemeral";
		const entryCount = this.#ctx.sessionManager.getEntries().length;

		lines.push(`  ${bold(accent("Session"))}`);
		const filePrefix = "    File: ";
		const maxFileWidth = Math.max(20, width - visibleWidth(filePrefix));
		const displayPath = sessionFile === "ephemeral"
			? sessionFile
			: truncateToWidth(sessionFile, maxFileWidth, "…");
		lines.push(filePrefix + muted(displayPath));
		lines.push(`    Entries: ${muted(String(entryCount))}`);
		lines.push("");

		// Model info
		const model = this.#ctx.model;
		lines.push(`  ${bold(accent("Model"))}`);
		if (model) {
			lines.push(`    Provider: ${muted(model.provider)}`);
			lines.push(`    Model: ${muted(model.id)}`);
			lines.push(`    Context: ${muted(String(model.contextWindow.toLocaleString()))} tokens`);
		} else {
			lines.push(`    ${dim("No model selected")}`);
		}
		lines.push("");

		// Tasks summary
		const doneCount = this.#todos.filter((t) => t.done).length;
		const totalCount = this.#todos.length;
		lines.push(`  ${bold(accent("Tasks"))}`);
		lines.push(`    ${success(String(doneCount))}${dim("/")}${muted(String(totalCount))} completed`);
		lines.push("");

		// Token usage (per-session)
		let inputTokens = 0;
		let outputTokens = 0;
		let totalCost = 0;

		for (const entry of this.#ctx.sessionManager.getBranch()) {
			if (entry.type === "message" && entry.message.role === "assistant") {
				const m = entry.message as AssistantMessage;
				inputTokens += m.usage.input;
				outputTokens += m.usage.output;
				totalCost += m.usage.cost.total;
			}
		}

		const fmt = formatTokens;

		lines.push(`  ${bold(accent("Token Usage"))} ${dim("(this session)")}`);
		lines.push(`    Input:  ${muted(fmt(inputTokens))}`);
		lines.push(`    Output: ${muted(fmt(outputTokens))}`);
		lines.push(`    Total:  ${muted(fmt(inputTokens + outputTokens))}`);
		lines.push("");

		lines.push(`  ${bold(accent("Cost"))} ${dim("(this session)")}`);
		lines.push(`    $${muted(totalCost.toFixed(4))}`);
		lines.push("");

		// Context usage
		const usage = this.#ctx.getContextUsage();
		if (usage) {
			lines.push(`  ${bold(accent("Context"))}`);
			lines.push(`    Used: ${muted(fmt(usage.tokens))}`);
			const percent = usage.percent === null ? "unknown" : `${usage.percent.toFixed(1)}%`;
			lines.push(`    Limit: ${muted(fmt(usage.contextWindow))} (${percent})`);
		}

		return lines;
	}

	// ========================================================================
	// Help overlay
	// ========================================================================

	#renderHelp(theme: Theme, _width: number): string[] {
		const lines: string[] = [];
		const accent = (s: string) => theme.fg("accent", s);
		const muted = (s: string) => theme.fg("muted", s);
		const bold = (s: string) => theme.bold(s);

		lines.push("");
		lines.push(`  ${bold(accent("Keyboard Shortcuts"))}`);
		lines.push("");
		lines.push(`  ${bold("Navigation")}`);
		lines.push(`    ${muted("1-5")}        Switch tab directly`);
		lines.push(`    ${muted("← →")}        Switch tab (with wraparound)`);
		lines.push(`    ${muted("?")}          Toggle this help`);
		lines.push(`    ${muted("Q / Esc")}    Close dashboard`);
		lines.push("");
		lines.push(`  ${bold("Tasks Tab")}`);
		lines.push(`    ${muted("↑ / ↓")}      Move selection`);
		lines.push(`    ${muted("Space / Enter")} Toggle done`);
		lines.push(`    ${muted("A")}          Add task`);
		lines.push(`    ${muted("E")}          Edit task`);
		lines.push(`    ${muted("X")}          Delete task`);
		lines.push(`    ${muted("J / K")}      Move task down / up`);
		lines.push("");
		lines.push(`  ${bold("Sessions Tab")}`);
		lines.push(`    ${muted("S")}          Switch to session`);
		lines.push(`    ${muted("B")}          Toggle bookmark`);
		lines.push(`    ${muted("F")}          Filter sessions`);
		lines.push("");
		lines.push(`  ${bold("Git Tab")}`);
		lines.push(`    ${muted("C")}          Checkout branch`);
		lines.push(`    ${muted("N")}          Create new branch`);
		lines.push(`    ${muted("D")}          Delete branch`);
		lines.push(`    ${muted("S")}          Stage file`);
		lines.push(`    ${muted("U")}          Unstage file`);
		lines.push(`    ${muted("R")}          Refresh status`);
		lines.push("");
		lines.push(`  ${bold("OmniRoute Tab")}`);
		lines.push(`    ${muted("R")}          Refresh combos and providers`);
		lines.push(`    ${muted("D")}          Toggle connection details`);
		lines.push(`    ${muted("PgUp / PgDn")} Scroll long panels or help`);
		lines.push("");
		lines.push(`  ${bold("Commands")}`);
		lines.push(`    ${muted("/dashboard")}  Open this dashboard`);
		lines.push(`    ${muted("/task [text]")} Add a task`);
		lines.push(`    ${muted("/todo")}        Manage tasks`);
		lines.push(`    ${muted("/footer")}      Toggle custom footer`);
		lines.push("");

		return lines;
	}

	#centerLine(line: string, width: number): string {
		const visibleLen = visibleWidth(line);
		if (visibleLen >= width) return truncateToWidth(line, width);
		const pad = Math.floor((width - visibleLen) / 2);
		return " ".repeat(pad) + line;
	}
}
