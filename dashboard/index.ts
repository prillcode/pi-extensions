/**
 * Dashboard Extension - A TUI dashboard for pi
 *
 * Commands: /dashboard, /task (or /todo), /footer
 * Shortcuts: Ctrl+Shift+D (dashboard), Ctrl+Shift+T (task widget)
 */

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
	Container,
	Key,
	Text,
	type SelectItem,
	SelectList,
	visibleWidth,
	truncateToWidth,
} from "@mariozechner/pi-tui";
import type { TodoItem } from "./types.js";
import { DashboardComponent } from "./components/Dashboard.js";

const TODO_SAVE_TYPE = "dashboard-todos";

export default function dashboardExtension(pi: ExtensionAPI) {
	let todos: TodoItem[] = [];
	let footerActive = false;
	let taskWidgetVisible = true;

	// ============================================================================
	// Helpers
	// ============================================================================

	function loadTodos(ctx: ExtensionContext): void {
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && entry.customType === TODO_SAVE_TYPE) {
				todos = (entry.data as TodoItem[]) ?? [];
				break;
			}
		}
	}

	function saveTodos(): void {
		pi.appendEntry(TODO_SAVE_TYPE, todos);
	}

	function updateTaskWidget(ctx: ExtensionContext): void {
		if (!taskWidgetVisible || todos.length === 0) {
			ctx.ui.setWidget("dashboard-tasks", undefined);
			return;
		}

		ctx.ui.setWidget(
			"dashboard-tasks",
			(_tui, theme) => {
				const lines = [
					theme.fg("accent", theme.bold("Tasks")),
					...todos.slice(0, 3).map((t) => {
						const checkbox = t.done ? theme.fg("success", "✓") : theme.fg("dim", "○");
						const text = t.done ? theme.fg("muted", t.text) : t.text;
						return `${checkbox} ${text}`;
					}),
				];
				if (todos.length > 3) {
					lines.push(theme.fg("dim", `...and ${todos.length - 3} more`));
				}
				return {
					render: () => lines,
					invalidate: () => {},
				};
			},
			{ placement: "belowEditor" },
		);
	}

	// Shared task handler for both /task and /todo
	async function taskHandler(args: string, ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI) {
			ctx.ui.notify("Task command requires interactive mode", "error");
			return;
		}

		// Quick add
		if (args?.trim()) {
			todos.push({
				id: Date.now().toString(),
				text: args.trim(),
				done: false,
			});
			saveTodos();
			updateTaskWidget(ctx);
			ctx.ui.notify(`Task added: ${args.trim()}`, "success");
			return;
		}

		// Show task selector UI
		const items: SelectItem[] = [
			{ value: "add", label: "➕ Add new task", description: "Create a new task" },
			...todos.map((t, i) => ({
				value: String(i),
				label: `${t.done ? "✓" : "○"} ${t.text}`,
				description: t.done ? "Done - press to uncheck" : "Pending - press to complete",
			})),
		];

		if (todos.length === 0) {
			items.push({ value: "none", label: "No tasks yet", description: "Add your first task" });
		}

		const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Task List")), 1, 0));

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

		if (result === "add") {
			const text = await ctx.ui.input("New task:", "");
			if (text?.trim()) {
				todos.push({
					id: Date.now().toString(),
					text: text.trim(),
					done: false,
				});
				saveTodos();
				updateTaskWidget(ctx);
				ctx.ui.notify("Task added", "success");
			}
		} else if (result !== "none") {
			const index = parseInt(result, 10);
			if (todos[index]) {
				todos[index].done = !todos[index].done;
				saveTodos();
				updateTaskWidget(ctx);
				ctx.ui.notify(todos[index].done ? "Task completed" : "Task reopened", "info");
			}
		}
	}

	// ============================================================================
	// Commands
	// ============================================================================

	pi.registerCommand("dashboard", {
		description: "Show session dashboard",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Dashboard requires interactive mode", "error");
				return;
			}

			await ctx.ui.custom((tui, _theme, _kb, done) => {
				return new DashboardComponent(tui, ctx, pi, () => done(undefined), todos, saveTodos);
			});
		},
	});

	pi.registerCommand("task", {
		description: "Manage task list",
		handler: taskHandler,
	});

	pi.registerCommand("todo", {
		description: "Manage task list (alias for /task)",
		handler: taskHandler,
	});

	pi.registerCommand("footer", {
		description: "Toggle custom dashboard footer",
		handler: async (_args, ctx) => {
			footerActive = !footerActive;

			if (!footerActive) {
				ctx.ui.setFooter(undefined);
				ctx.ui.notify("Default footer restored", "info");
				return;
			}

			ctx.ui.setFooter((tui, theme, footerData) => {
				const unsub = footerData.onBranchChange(() => tui.requestRender());

				return {
					dispose: unsub,
					invalidate() {},
					render(width: number): string[] {
						let input = 0, output = 0, cost = 0;
						for (const e of ctx.sessionManager.getBranch()) {
							if (e.type === "message" && e.message.role === "assistant") {
								const m = e.message as AssistantMessage;
								input += m.usage.input;
								output += m.usage.output;
								cost += m.usage.cost.total;
							}
						}

						const branch = footerData.getGitBranch();
						const fmt = (n: number) => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`);

						const left = theme.fg("dim", `↑${fmt(input)} ↓${fmt(output)} $${cost.toFixed(3)}`);
						const taskStatus = todos.length > 0 ? ` | ${todos.filter((t) => t.done).length}/${todos.length} ✓` : "";
						const branchStr = branch ? ` (${branch})` : "";
						const right = theme.fg("dim", `${ctx.model?.id || "no-model"}${branchStr}${taskStatus}`);

						const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - visibleWidth(right)));
						return [truncateToWidth(left + pad + right, width)];
					},
				};
			});
			ctx.ui.notify("Custom footer enabled", "info");
		},
	});

	// ============================================================================
	// Shortcuts
	// ============================================================================

	pi.registerShortcut(Key.ctrlShift("d"), {
		description: "Open dashboard",
		handler: async (ctx) => {
			ctx.ui.notify("Use /dashboard to open the dashboard", "info");
		},
	});

	pi.registerShortcut(Key.ctrlShift("t"), {
		description: "Toggle task widget",
		handler: async (ctx) => {
			taskWidgetVisible = !taskWidgetVisible;
			updateTaskWidget(ctx);
			ctx.ui.notify(taskWidgetVisible ? "Task widget visible" : "Task widget hidden", "info");
		},
	});

	// ============================================================================
	// Events
	// ============================================================================

	pi.on("session_start", async (_event, ctx) => {
		loadTodos(ctx);
		updateTaskWidget(ctx);
		ctx.ui.notify("Dashboard loaded • /dashboard /task /footer • Ctrl+Shift+D", "info");
	});

	pi.on("turn_end", async (_event, ctx) => {
		updateTaskWidget(ctx);
	});
}
