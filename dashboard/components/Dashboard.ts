/**
 * Dashboard Component - Main dashboard UI
 *
 * Tabs: 1:Tasks  2:Sessions  3:Git  4:Brain  5:Info
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, visibleWidth, truncateToWidth, Container, Text, SelectList, type SelectItem } from "@mariozechner/pi-tui";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import type { TodoItem, DashboardTab } from "../types.js";
import { GitPanel } from "./GitPanel.js";
import { SessionPanel } from "./SessionPanel.js";
import { BrainPanel } from "./BrainPanel.js";

const TABS: { key: DashboardTab; label: string; shortcut: string }[] = [
	{ key: "tasks", label: "Tasks", shortcut: "1" },
	{ key: "sessions", label: "Sessions", shortcut: "2" },
	{ key: "git", label: "Git", shortcut: "3" },
	{ key: "brain", label: "Brain", shortcut: "4" },
	{ key: "info", label: "Info", shortcut: "5" },
];

export class DashboardComponent {
	#ctx: ExtensionContext;
	#pi: ExtensionAPI;
	#onClose: () => void;
	#tui: { requestRender: () => void };
	#todos: TodoItem[];
	#selectedTab: DashboardTab = "tasks";
	#showHelp = false;
	#cachedLines: string[] = [];
	#cachedWidth = 0;
	#gitPanel: GitPanel;
	#sessionPanel: SessionPanel;
	#brainPanel: BrainPanel;
	#saveTodos: () => void;

	constructor(
		tui: { requestRender: () => void },
		ctx: ExtensionContext,
		pi: ExtensionAPI,
		onClose: () => void,
		todos: TodoItem[],
		saveTodos: () => void,
	) {
		this.#tui = tui;
		this.#ctx = ctx;
		this.#pi = pi;
		this.#onClose = onClose;
		this.#todos = todos;
		this.#saveTodos = saveTodos;
		this.#gitPanel = new GitPanel(ctx, () => {
			this.invalidate();
			this.#tui.requestRender();
		});
		this.#sessionPanel = new SessionPanel(ctx, () => {
			this.invalidate();
			this.#tui.requestRender();
		});
		this.#brainPanel = new BrainPanel(ctx, pi, () => {
			this.invalidate();
			this.#tui.requestRender();
		}, () => this.#onClose());
	}

	get #tabIndex(): number {
		return TABS.findIndex((t) => t.key === this.#selectedTab);
	}

	handleInput(data: string): void {
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
		if (data === "4") return this.#switchTab("brain");
		if (data === "5") return this.#switchTab("info");

		// Tab-specific actions
		// M = menu on any tab
		if (data === "m" || data === "M") {
			if (this.#selectedTab === "tasks") {
				this.#tasksMenu().catch(() => {});
			} else if (this.#selectedTab === "sessions") {
				this.#sessionPanel.handleAction("menu").catch(() => {});
			} else if (this.#selectedTab === "git") {
				this.#gitPanel.handleAction("menu").catch(() => {});
			} else if (this.#selectedTab === "brain") {
				this.#brainPanel.showMenu().catch(() => {});
			}
			return;
		}

		if (this.#selectedTab === "tasks") {
			if (data === "a" || data === "A") {
				this.#addTask().catch(() => {});
			}
		} else if (this.#selectedTab === "git") {
			if (data === "c" || data === "C") this.#gitPanel.handleAction("checkout").catch(() => {});
			else if (data === "n" || data === "N") this.#gitPanel.handleAction("create").catch(() => {});
			else if (data === "d" || data === "D") this.#gitPanel.handleAction("delete").catch(() => {});
			else if (data === "s" || data === "S") this.#gitPanel.handleAction("stage").catch(() => {});
			else if (data === "u" || data === "U") this.#gitPanel.handleAction("unstage").catch(() => {});
		} else if (this.#selectedTab === "sessions") {
			if (data === "s" || data === "S") this.#sessionPanel.handleAction("switch").catch(() => {});
			else if (data === "b" || data === "B") {
				// Bookmark not implemented yet
				this.#ctx.ui.notify("Bookmark toggle not yet implemented", "warning");
			}
		} else if (this.#selectedTab === "brain") {
			if (this.#brainPanel.isViewing()) {
				if (data === "b" || data === "B" || matchesKey(data, Key.escape)) {
					this.#brainPanel.handleAction("back");
				}
			} else {
				const num = parseInt(data, 10);
				if (!isNaN(num) && num >= 0) {
					this.#brainPanel.viewFile(num).catch(() => {});
				}
			}
		}
	}

	#switchTab(tab: DashboardTab): void {
		this.#selectedTab = tab;
		if (tab === "git") this.#gitPanel.refresh();
		if (tab === "sessions") void this.#sessionPanel.refresh();
		this.invalidate();
		this.#tui.requestRender();
	}

	// ========================================================================
	// Tasks helpers
	// ========================================================================

	async #tasksMenu(): Promise<void> {
		try {
			const items: SelectItem[] = [
				{ value: "add", label: "Add task", description: "Create a new task" },
				{ value: "manage", label: "Manage tasks", description: "Run /task" },
			];

			const result = await this.#ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Task Actions")), 1, 0));

			const selectList = new SelectList(items, Math.min(items.length, 10), {
				selectedPrefix: (t) => theme.fg("accent", t),
				selectedText: (t) => theme.fg("accent", t),
				description: (t) => theme.fg("muted", t),
				scrollInfo: (t) => theme.fg("dim", t),
				noMatch: (t) => theme.fg("warning", t),
			});

			selectList.onSelect = (item) => done(item.value);
			selectList.onCancel = () => done(null);
			container.addChild(selectList);
			container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc close"), 1, 0));
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

			return {
				render: (w) => container.render(w),
				invalidate: () => container.invalidate(),
				handleInput: (data) => {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!result) return;
		if (result === "add") await this.#addTask();
		else if (result === "manage") {
			try {
				this.#pi.sendUserMessage("/task");
				this.#onClose();
			} catch (error) {
				this.#ctx.ui.notify(`Failed to run /task: ${error}`, "error");
			}
		}
		} catch (error) {
			this.#ctx.ui.notify(`Menu error: ${error}`, "error");
		}
	}

	async #addTask(): Promise<void> {
		try {
			const text = await this.#ctx.ui.input("New task:", "");
			if (!text?.trim()) return;
			this.#todos.push({ id: Date.now().toString(), text: text.trim(), done: false });
			this.#saveTodos();
			this.invalidate();
			this.#tui.requestRender();
			this.#ctx.ui.notify(`Task added: ${text.trim()}`, "success");
		} catch (error) {
			this.#ctx.ui.notify(`Failed to add task: ${error}`, "error");
		}
	}

	invalidate(): void {
		this.#cachedWidth = 0;
	}

	render(width: number): string[] {
		if (width === this.#cachedWidth && this.#cachedLines.length > 0) {
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
				case "brain":
					lines.push(...this.#brainPanel.render(theme, width));
					break;
				case "info":
					lines.push(...this.#renderInfo(width));
					break;
			}
		}

		lines.push(dim("─".repeat(width)));
		lines.push(this.#renderFooter(theme, width));

		this.#cachedLines = lines;
		this.#cachedWidth = width;
		return lines;
	}

	#renderHeader(theme: ReturnType<ExtensionContext["ui"]["theme"]>, width: number): string {
		const title = ` ${theme.bold(theme.fg("accent", "π Dashboard"))} `;
		return this.#centerLine(title, width);
	}

	#renderTabBar(theme: ReturnType<ExtensionContext["ui"]["theme"]>, width: number): string {
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

	#renderFooter(theme: ReturnType<ExtensionContext["ui"]["theme"]>, width: number): string {
		const dim = (s: string) => theme.fg("dim", s);

		if (this.#showHelp) {
			return this.#centerLine(dim("Any key to close help"), width);
		}

		const hints: Record<string, string> = {
			tasks: "A-add task • M-menu • ? help • Q close",
			sessions: "S-switch • M-menu • ? help • Q close",
			git: "C-checkout • N-new • D-delete • S-stage • U-unstage • M-menu",
			brain: "0-9 view file • B-back • M-menu • ? help • Q close",
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
			lines.push(dim("  No tasks yet. Use /task to add items."));
			return lines;
		}

		const doneCount = this.#todos.filter((t) => t.done).length;
		lines.push(`  ${bold(accent("Tasks"))} ${dim("(")}${success(String(doneCount))}${dim("/")}${muted(String(this.#todos.length))}${dim(" completed)")}`);
		lines.push("");

		for (const todo of this.#todos) {
			const checkbox = todo.done ? success("✓") : dim("○");
			const text = todo.done ? muted(todo.text) : todo.text;
			lines.push(`    ${checkbox} ${text}`);
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

		const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

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
			if (usage.limit) {
				const pct = ((usage.tokens / usage.limit) * 100).toFixed(1);
				lines.push(`    Limit: ${muted(fmt(usage.limit))} (${pct}%)`);
			}
		}

		return lines;
	}

	// ========================================================================
	// Help overlay
	// ========================================================================

	#renderHelp(theme: ReturnType<ExtensionContext["ui"]["theme"]>, _width: number): string[] {
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
		lines.push(`    ${muted("/task [text]")} Add a task`);
		lines.push(`    ${muted("/todo")}        Manage tasks`);
		lines.push("");
		lines.push(`  ${bold("Sessions Tab")}`);
		lines.push(`    ${muted("S")}          Switch to session`);
		lines.push(`    ${muted("B")}          Toggle bookmark`);
		lines.push("");
		lines.push(`  ${bold("Git Tab")}`);
		lines.push(`    ${muted("C")}          Checkout branch`);
		lines.push(`    ${muted("N")}          Create new branch`);
		lines.push(`    ${muted("D")}          Delete branch`);
		lines.push(`    ${muted("S")}          Stage file`);
		lines.push(`    ${muted("U")}          Unstage file`);
		lines.push("");
		lines.push(`  ${bold("Brain Tab")}`);
		lines.push(`    ${muted("0-9")}        View file by number`);
		lines.push(`    ${muted("B")}          Back to file list`);
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
