import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import extension from "../index.js";
import { DashboardComponent } from "../components/Dashboard.js";
import { OmniRoutePanel } from "../components/OmniRoutePanel.js";
import { SessionPanel } from "../components/SessionPanel.js";
import { formatTokens } from "../utils/format.js";
import { loadBookmarks, toggleBookmark } from "../utils/bookmarks.js";
import { getSessionStats, listSessions, formatSessionName } from "../utils/sessions.js";
import * as git from "../utils/git.js";
import { parseOmniRouteData, getOmniRouteData } from "../utils/omniroute.js";

const pause = (ms = 15) => new Promise(resolve => setTimeout(resolve, ms));
const theme: any = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
function fakeDialog(ctx: any, value: string) {
	ctx.ui.custom = async (factory: any) => {
		let result: unknown;
		const component = factory({ requestRender() {} }, theme, {}, (v: unknown) => { result = v; });
		component.focused = true;
		if (component.render(90).join("\n").includes("No")) component.handleInput("\x1b[B");
		else { component.handleInput("\x01"); component.handleInput("\x0b"); component.handleInput(value); }
		component.handleInput("\r");
		return result;
	};
}
function context(cwd = tmpdir()): any {
	return { mode: "tui", hasUI: true, cwd, model: { provider: "router", id: "maestro", contextWindow: 1_000_000 },
		getContextUsage: () => ({ tokens: 1200, contextWindow: 1_000_000, percent: 0.12 }),
		sessionManager: { getEntries: () => [], getBranch: () => [], getSessionFile: () => undefined, getSessionDir: () => join(cwd, "sessions") },
		ui: { theme, notify() {}, setWidget() {}, setFooter() {}, input: async () => "edited", confirm: async () => true },
	};
}
async function temporary(run: (dir: string) => Promise<void>) {
	const dir = await mkdtemp(join(tmpdir(), "dashboard-test-"));
	try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const comboFixture = { combos: [{ name: "maestro-standard", strategy: "priority", sortOrder: 2, computed_context_length: 262144,
	models: [{ model: "openrouter/vendor/model", providerId: "openrouter", weight: 2 }] }] };
const providerFixture = { connections: [{ provider: "openrouter", name: "primary", isActive: true, testStatus: "active", priority: 1, apiKey: "NEVER_RENDER_ME" }] };

test("token formatting and session timestamp", () => {
	assert.equal(formatTokens(1_000_000), "1.0M"); assert.equal(formatTokens(null), "unknown");
	assert.equal(formatSessionName("/x/2026-04-18T03-50-29-543Z_id.jsonl"), "2026-04-18 03:50:29 UTC");
});

test("bookmarks persist, serialize toggles, and reject malformed user state", async () => temporary(async dir => {
	const path = join(dir, "bookmarks.json"); assert.equal((await loadBookmarks(path)).size, 0);
	await Promise.all([toggleBookmark("one", path), toggleBookmark("two", path)]);
	assert.deepEqual([...await loadBookmarks(path)].sort(), ["one", "two"]);
	await toggleBookmark("one", path); assert.deepEqual([...await loadBookmarks(path)], ["two"]);
	await writeFile(path, "broken"); await assert.rejects(toggleBookmark("three", path));
	assert.equal(await readFile(path, "utf8"), "broken");
}));

test("session stats stream malformed records safely and invalidate changed-file cache", async () => temporary(async dir => {
	const path = join(dir, "usage.jsonl");
	await writeFile(path, JSON.stringify({ type: "message", message: { role: "assistant", usage: { input: 100, output: 20, cost: { total: 0.2 } } } }) + "\nbad\n");
	assert.equal((await getSessionStats(path)).inputTokens, 100);
	await writeFile(path, "{}\n"); assert.equal((await getSessionStats(path)).inputTokens, 0);
}));

test("uses Pi 1.x session path/name/modified/current-session fields and filter", async () => temporary(async dir => {
	const sessionDir = join(dir, "sessions"); const manager = SessionManager.create(dir, sessionDir);
	manager.appendSessionInfo("Named test session");
	manager.appendMessage({ role: "user", content: "first message", timestamp: Date.now() });
	const file = manager.getSessionFile()!;
	const sessions = await listSessions(dir, file, sessionDir);
	assert.equal(sessions.length, 1); assert.equal(sessions[0]!.file, file);
	assert.equal(sessions[0]!.name, "Named test session"); assert.equal(sessions[0]!.isCurrent, true);
	const ctx = context(dir); ctx.sessionManager = manager;
	const panel = new SessionPanel(ctx, () => {}, () => {});
	await panel.refresh(); assert.match(panel.render(theme, 80).join("\n"), /Named test session/);
	fakeDialog(ctx, "no-match"); await panel.handleAction("filter");
	assert.match(panel.render(theme, 80).join("\n"), /No sessions match/);
	fakeDialog(ctx, ""); await panel.handleAction("filter");
	assert.match(panel.render(theme, 80).join("\n"), /Named test session/);
	const bookmarkPath = join(getAgentDir(), "dashboard-bookmarks.json");
	const before = await loadBookmarks(bookmarkPath);
	ctx.ui.custom = async (factory: any) => {
		let selected: unknown;
		const component = factory({ requestRender() {} }, theme, {}, (v: unknown) => { selected = v; });
		component.handleInput("\r"); return selected;
	};
	await panel.handleAction("bookmark");
	assert.equal((await loadBookmarks(bookmarkPath)).has(file), !before.has(file));
	await panel.handleAction("bookmark");
	assert.equal((await loadBookmarks(bookmarkPath)).has(file), before.has(file));
	panel.dispose();
}));

test("tasks toggle/edit/delete/reorder/add persist; tabs and narrow/height rendering", async () => temporary(async dir => {
	const ctx = context(dir), tui = { terminal: { rows: 30 }, requestRender() {} };
	fakeDialog(ctx, "edited");
	const tasks = [{ id: "a", text: "first", done: false }, { id: "b", text: "second", done: false }];
	let saves = 0;
	const dash = new DashboardComponent(tui, ctx, {} as any, () => {}, tasks, () => saves++);
	dash.handleInput(" "); assert.equal(tasks[0]!.done, true);
	dash.handleInput("j"); assert.equal(tasks[1]!.id, "a");
	dash.handleInput("k"); assert.equal(tasks[0]!.id, "a");
	dash.handleInput("e"); await pause(); assert.equal(tasks[0]!.text, "edited");
	dash.handleInput("x"); await pause(); assert.equal(tasks.length, 1);
	dash.handleInput("a"); await pause(); assert.equal(tasks.length, 2); assert.ok(saves >= 6);
	dash.handleInput("5"); const info = dash.render(90).join("\n");
	assert.match(info, /Limit: 1\.0M \(0\.1%\)/); assert.doesNotMatch(info, /Brain/);
	ctx.getContextUsage = () => ({ tokens: null, contextWindow: 1_000_000, percent: null }); dash.invalidate();
	assert.match(dash.render(90).join("\n"), /Used: unknown/);
	for (const width of [1, 20, 40, 80, 120]) assert.ok(dash.render(width).every(line => visibleWidth(line) <= width));
	tui.terminal.rows = 12; assert.ok(dash.render(80).length <= 12);
	ctx.ui.custom = async (factory: any) => {
		let selected: unknown;
		const component = factory({ requestRender() {} }, theme, {}, (v: unknown) => { selected = v; });
		component.handleInput("\x1b"); return selected;
	};
	dash.handleInput("e"); await pause(); // Info tab ignores task actions.
	dash.handleInput("1"); dash.handleInput("x"); await pause(); assert.equal(tasks.length, 2); // Cancel is non-destructive.
	dash.dispose(); dash.dispose();
}));

test("async git supports spaces, quotes, rename records, feature/slash branches and mutations", async () => temporary(async dir => {
	const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
	run("init", "-b", "main"); run("config", "user.name", "Test"); run("config", "user.email", "test@example.invalid");
	await writeFile(join(dir, "old file"), "original"); run("add", "."); run("commit", "-m", "Subject | intact");
	assert.equal((await git.getRecentCommits(dir, 5))[0]!.message, "Subject | intact");
	await git.createBranch(dir, "feature/slash"); assert.equal((await git.getGitStatus(dir)).branch, "feature/slash");
	await git.checkoutBranch(dir, "main"); await git.deleteBranch(dir, "feature/slash");
	const name = 'file "; $(echo injection)'; await writeFile(join(dir, name), "safe");
	assert.ok((await git.getGitStatus(dir)).untracked.includes(name));
	await git.stageFile(dir, name); assert.ok((await git.getGitStatus(dir)).staged.includes(name));
	await git.unstageFile(dir, name); assert.ok((await git.getGitStatus(dir)).untracked.includes(name));
	run("mv", "old file", "new file"); assert.ok((await git.getGitStatus(dir)).staged.includes("new file"));
	assert.equal((await git.getBranches(dir))[0]!.current, true);
}));

test("OmniRoute allowlists metadata, polls only while active, reveals details and disposes", async () => {
	const data = parseOmniRouteData(comboFixture, providerFixture);
	assert.doesNotMatch(JSON.stringify(data), /NEVER_RENDER_ME|apiKey/);
	assert.throws(() => parseOmniRouteData({}, providerFixture));
	const originalFetch = globalThis.fetch, originalKey = process.env.OMNIROUTE_MANAGE_KEY;
	process.env.OMNIROUTE_MANAGE_KEY = "test-only"; let requests = 0, changes = 0;
	globalThis.fetch = (async (url: string) => { requests++; return new Response(JSON.stringify(url.endsWith("/api/combos") ? comboFixture : providerFixture)); }) as any;
	const panel = new OmniRoutePanel(context(), () => changes++, 20);
	try {
		await pause(30); assert.equal(requests, 0);
		panel.setActive(true); await pause(75); assert.ok(requests >= 4);
		assert.match(panel.render(theme, 100).join("\n"), /weight 2/);
		panel.toggleDetails(); assert.match(panel.render(theme, 100).join("\n"), /primary/);
		assert.doesNotMatch(panel.render(theme, 100).join("\n"), /NEVER_RENDER_ME/);
		panel.setActive(false); await pause(); const count = requests; await pause(60); assert.equal(requests, count);
		globalThis.fetch = (async () => new Response("{}", { status: 401 })) as any;
		await panel.refresh(); assert.match(panel.render(theme, 100).join("\n"), /HTTP 401.*stale data/);
		panel.dispose(); const renders = changes; await pause(50); assert.equal(changes, renders);
	} finally { panel.dispose(); globalThis.fetch = originalFetch; if (originalKey === undefined) delete process.env.OMNIROUTE_MANAGE_KEY; else process.env.OMNIROUTE_MANAGE_KEY = originalKey; }
});

test("command and shortcut really open dashboard; widget updates; todos reset and branch state restores", async () => {
	const commands = new Map(), shortcuts = new Map(), events = new Map(), snapshots: any[] = [];
	const pi: any = { registerCommand: (name: string, value: any) => commands.set(name, value), registerShortcut: (key: string, value: any) => shortcuts.set(key, value), on: (event: string, value: any) => events.set(event, value), appendEntry: (_type: string, data: unknown) => snapshots.push(data) };
	extension(pi); const ctx = context(); let screens = 0, widgets = 0;
	ctx.ui.setWidget = () => widgets++;
	ctx.ui.custom = async (factory: any) => { screens++; const component = factory({ requestRender() {}, terminal: { rows: 40 } }, theme, {}, () => {}); assert.ok(component.render(80).length); component.handleInput(" "); component.dispose(); };
	await commands.get("todo").handler("new todo", ctx);
	await commands.get("dashboard").handler("", ctx); await shortcuts.get("ctrl+alt+d").handler(ctx);
	assert.equal(screens, 2); assert.ok(widgets >= 3); assert.equal(snapshots[0][0].done, false);
	ctx.sessionManager.getBranch = () => [{ type: "custom", customType: "dashboard-todos", data: [{ id: "z", text: "restored", done: false }] }];
	await events.get("session_start")({}, ctx); await commands.get("todo").handler("more", ctx); assert.equal(snapshots.at(-1).length, 2);
	ctx.sessionManager.getBranch = () => []; await events.get("session_start")({}, ctx);
	await commands.get("todo").handler("only new", ctx); assert.equal(snapshots.at(-1).length, 1);
	ctx.mode = "rpc"; await commands.get("dashboard").handler("", ctx); assert.equal(screens, 2);
});

test("session switch is deferred until custom UI closes and is unavailable from shortcut context", async () => temporary(async dir => {
	const manager = SessionManager.create(dir, join(dir, "sessions"));
	manager.appendMessage({ role: "user", content: "switch target", timestamp: Date.now() });
	const file = manager.getSessionFile()!;
	const commands = new Map(), shortcuts = new Map();
	extension({ registerCommand: (name: string, value: any) => commands.set(name, value), registerShortcut: (name: string, value: any) => shortcuts.set(name, value), on() {}, appendEntry() {} } as any);
	const ctx = context(dir); ctx.sessionManager.getSessionDir = () => manager.getSessionDir();
	const order: string[] = [];
	ctx.switchSession = async (selected: string) => { assert.equal(selected, file); order.push("switch"); };
	ctx.ui.custom = async (factory: any) => {
		let resolved: unknown;
		const component = factory({ requestRender() {} }, theme, {}, (value: unknown) => { resolved = value; });
		if (component.render(90).join("\n").includes("Select Session")) { component.handleInput("\r"); return resolved; }
		component.handleInput("2"); await pause(60); component.handleInput("s"); await pause(30);
		component.dispose(); order.push("ui closed"); return undefined;
	};
	await commands.get("dashboard").handler("", ctx);
	assert.deepEqual(order, ["ui closed", "switch"]);
	delete ctx.switchSession; let message = ""; ctx.ui.notify = (text: string) => { message = text; };
	await shortcuts.get("ctrl+alt+d").handler(ctx);
	assert.match(message, /shortcuts have no command context/);
}));

if (process.env.DASHBOARD_LIVE_TEST === "1") test("live gateway metadata fetch (no provider credentials printed)", async () => {
	const data = await getOmniRouteData(); assert.ok(data.combos.some(c => c.name.startsWith("maestro-")));
	assert.ok(data.providers.length); assert.doesNotMatch(JSON.stringify(data), /apiKey|providerSpecificData/);
});
