import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { promises as fs } from "node:fs";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

type OpenSpecResult = {
	code: number;
	stdout: string;
	stderr: string;
	combined: string;
};

type RepoOpenSpecState = {
	rootDir: string;
	specs: string[];
	changes: string[];
	archivedChanges: string[];
};

type CommandCtx = {
	cwd: string;
	hasUI: boolean;
	ui: {
		notify: (message: string, level?: "info" | "success" | "warning" | "error") => void;
		confirm: (title: string, message: string) => Promise<boolean>;
	};
	isIdle: () => boolean;
};

const OPEN_SPEC_TOOL_PARAMETERS = Type.Object({
	action: Type.Union(
		[
			Type.Literal("init"),
			Type.Literal("update"),
			Type.Literal("archive"),
			Type.Literal("list_changes"),
			Type.Literal("list_specs"),
			Type.Literal("show"),
			Type.Literal("validate"),
			Type.Literal("status"),
			Type.Literal("instructions"),
			Type.Literal("new_change"),
		],
		{ description: "OpenSpec CLI action to perform" },
	),
	itemName: Type.Optional(Type.String({ description: "Change or spec name" })),
	itemType: Type.Optional(Type.Union([Type.Literal("change"), Type.Literal("spec")], { description: "Item type when needed" })),
	artifact: Type.Optional(Type.String({ description: "Artifact name for instructions, e.g. proposal, design, tasks" })),
	description: Type.Optional(Type.String({ description: "Description for new_change" })),
	strict: Type.Optional(Type.Boolean({ description: "Use strict validation" })),
	all: Type.Optional(Type.Boolean({ description: "Validate all changes and specs" })),
	json: Type.Optional(Type.Boolean({ description: "Request JSON output when supported" })),
	force: Type.Optional(Type.Boolean({ description: "Force non-interactive CLI behavior when supported" })),
	skipSpecs: Type.Optional(Type.Boolean({ description: "Archive without updating specs" })),
	noValidate: Type.Optional(Type.Boolean({ description: "Archive without validation" })),
	yes: Type.Optional(Type.Boolean({ description: "Skip archive confirmation prompts" })),
});

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

function listChildDirectoriesSync(targetPath: string): string[] {
	if (!existsSync(targetPath)) return [];
	return readdirSync(targetPath, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
		.map((entry) => entry.name)
		.sort();
}

async function listChildDirectories(targetPath: string): Promise<string[]> {
	if (!(await pathExists(targetPath))) return [];
	const entries = await fs.readdir(targetPath, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
		.map((entry) => entry.name)
		.sort();
}

function getOpenSpecStateSync(cwd: string): RepoOpenSpecState | undefined {
	const rootDir = path.join(cwd, "openspec");
	if (!existsSync(rootDir)) return undefined;
	return {
		rootDir,
		specs: listChildDirectoriesSync(path.join(rootDir, "specs")),
		changes: listChildDirectoriesSync(path.join(rootDir, "changes")).filter((name) => name !== "archive"),
		archivedChanges: listChildDirectoriesSync(path.join(rootDir, "changes", "archive")),
	};
}

async function getOpenSpecState(cwd: string): Promise<RepoOpenSpecState | undefined> {
	const rootDir = path.join(cwd, "openspec");
	if (!(await pathExists(rootDir))) return undefined;
	const specs = await listChildDirectories(path.join(rootDir, "specs"));
	const changes = (await listChildDirectories(path.join(rootDir, "changes"))).filter((name) => name !== "archive");
	const archivedChanges = await listChildDirectories(path.join(rootDir, "changes", "archive"));
	return { rootDir, specs, changes, archivedChanges };
}

function parseArgs(input: string): string[] {
	const matches = input.match(/(?:"[^"]*"|'[^']*'|\S+)/g) ?? [];
	return matches.map((token) => token.replace(/^['"]|['"]$/g, ""));
}

function buildOpenSpecArgs(params: {
	action: string;
	itemName?: string;
	itemType?: "change" | "spec";
	artifact?: string;
	description?: string;
	strict?: boolean;
	all?: boolean;
	json?: boolean;
	force?: boolean;
	skipSpecs?: boolean;
	noValidate?: boolean;
	yes?: boolean;
}): string[] {
	switch (params.action) {
		case "init":
			return ["init", ".", "--tools", "pi", "--force"];
		case "update":
			return ["update", ".", ...(params.force === false ? [] : ["--force"] )];
		case "archive": {
			const args = ["archive"];
			if (params.itemName) args.push(params.itemName);
			if (params.yes !== false) args.push("--yes");
			if (params.skipSpecs) args.push("--skip-specs");
			if (params.noValidate) args.push("--no-validate");
			return args;
		}
		case "list_changes":
			return ["list", "--changes", ...(params.json ? ["--json"] : [])];
		case "list_specs":
			return ["list", "--specs", ...(params.json ? ["--json"] : [])];
		case "show": {
			const args = ["show"];
			if (params.itemName) args.push(params.itemName);
			if (params.itemType) args.push("--type", params.itemType);
			if (params.json) args.push("--json");
			args.push("--no-interactive");
			return args;
		}
		case "validate": {
			const args = ["validate"];
			if (params.all) args.push("--all");
			else if (params.itemName) args.push(params.itemName);
			if (params.itemType) args.push("--type", params.itemType);
			if (params.strict) args.push("--strict");
			if (params.json) args.push("--json");
			args.push("--no-interactive");
			return args;
		}
		case "status": {
			const args = ["status"];
			if (params.itemName) args.push("--change", params.itemName);
			if (params.json) args.push("--json");
			return args;
		}
		case "instructions": {
			const args = ["instructions"];
			if (params.artifact) args.push(params.artifact);
			if (params.itemName) args.push("--change", params.itemName);
			if (params.json) args.push("--json");
			return args;
		}
		case "new_change": {
			const args = ["new", "change"];
			if (params.itemName) args.push(params.itemName);
			if (params.description) args.push("--description", params.description);
			return args;
		}
		default:
			throw new Error(`Unsupported action: ${params.action}`);
	}
}

async function runOpenSpec(cwd: string, args: string[]): Promise<OpenSpecResult> {
	return await new Promise((resolve, reject) => {
		const child = spawn("openspec", args, {
			cwd,
			env: {
				...process.env,
				OPENSPEC_TELEMETRY: "0",
				NO_COLOR: "1",
				FORCE_COLOR: "0",
			},
		});

		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => { stdout += String(chunk); });
		child.stderr.on("data", (chunk) => { stderr += String(chunk); });
		child.on("error", reject);
		child.on("close", (code) => {
			const cleanedStdout = stdout.trim();
			const cleanedStderr = stderr.trim();
			resolve({
				code: code ?? 0,
				stdout: cleanedStdout,
				stderr: cleanedStderr,
				combined: [cleanedStdout, cleanedStderr].filter(Boolean).join("\n\n"),
			});
		});
	});
}

function toAutocompleteItems(items: string[], prefix: string) {
	const filtered = items.filter((item) => item.startsWith(prefix));
	return filtered.length > 0 ? filtered.map((item) => ({ value: item, label: item })) : null;
}

function postCommandOutput(pi: ExtensionAPI, title: string, body: string) {
	pi.sendMessage({
		customType: "openspec-output",
		content: `${title}\n\n${body || "(no output)"}`,
		display: true,
	});
}

function extractTaggedBlock(text: string, tag: string): string | undefined {
	const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
	return match?.[1]?.trim();
}

function extractOutputPath(text: string): string | undefined {
	const match = text.match(/Write to:\s*(.+)/i);
	return match?.[1]?.trim();
}

function resolveChangeArg(args: string[], state?: RepoOpenSpecState): string | undefined {
	const explicit = args.find((part) => !part.startsWith("--"));
	if (explicit) return explicit;
	if (state?.changes.length === 1) return state.changes[0];
	return undefined;
}

function resolveDraftInput(args: string[], state?: RepoOpenSpecState) {
	const filtered = args.filter((part) => !part.startsWith("--"));
	if (filtered.length === 0) return { change: undefined, sourcePaths: [] as string[] };
	if (state && filtered[0] && (state.changes.includes(filtered[0]) || state.archivedChanges.includes(filtered[0]))) {
		return { change: filtered[0], sourcePaths: filtered.slice(1) };
	}
	if (state?.changes.length === 1) {
		return { change: state.changes[0], sourcePaths: filtered };
	}
	return { change: filtered[0], sourcePaths: filtered.slice(1) };
}

function collectMarkdownFilesSync(root: string, current = root, depth = 0, results: string[] = []): string[] {
	if (depth > 4) return results;
	for (const entry of readdirSync(current, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		if (entry.isDirectory()) {
			if (["node_modules", "dist", "build", ".git"].includes(entry.name)) continue;
			collectMarkdownFilesSync(root, path.join(current, entry.name), depth + 1, results);
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".md")) {
			results.push(path.relative(root, path.join(current, entry.name)));
		}
	}
	return results.sort();
}

function getChangeCompletions(cwd: string, prefix: string, includeArchived = false) {
	const state = getOpenSpecStateSync(cwd);
	if (!state) return null;
	const items = includeArchived ? [...state.changes, ...state.archivedChanges] : state.changes;
	return toAutocompleteItems(items, prefix);
}

function getDraftArgumentCompletions(cwd: string, prefix: string) {
	const state = getOpenSpecStateSync(cwd);
	const markdown = collectMarkdownFilesSync(cwd);
	const items = state?.changes.length === 1 ? markdown : [...(state?.changes ?? []), ...markdown];
	return toAutocompleteItems(items, prefix);
}

async function validateSourceDocs(cwd: string, sourcePaths: string[]) {
	const normalized: string[] = [];
	const missing: string[] = [];
	for (const sourcePath of sourcePaths) {
		const abs = path.resolve(cwd, sourcePath);
		if (!(await pathExists(abs))) {
			missing.push(sourcePath);
			continue;
		}
		const stat = await fs.stat(abs);
		if (!stat.isFile()) {
			missing.push(sourcePath);
			continue;
		}
		normalized.push(path.relative(cwd, abs));
	}
	return { normalized, missing };
}

async function queueDraftPrompt(pi: ExtensionAPI, ctx: CommandCtx, prompt: string, label: string) {
	if (ctx.isIdle()) {
		pi.sendUserMessage(prompt);
		ctx.ui.notify(`${label} prompt sent`, "success");
		return;
	}
	pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	ctx.ui.notify(`${label} prompt queued as follow-up`, "success");
}

async function scaffoldArtifactFromInstructions(
	pi: ExtensionAPI,
	ctx: CommandCtx,
	artifact: string,
	change: string,
	force = false,
): Promise<string | undefined> {
	const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "instructions", artifact, itemName: change }));
	if (result.code !== 0) {
		ctx.ui.notify(`OpenSpec instructions failed: ${artifact}`, "error");
		postCommandOutput(pi, `OpenSpec instructions for ${artifact} (${change})`, result.combined);
		return undefined;
	}

	const outputPath = extractOutputPath(result.combined);
	const template = extractTaggedBlock(result.combined, "template");
	if (!outputPath || !template) {
		ctx.ui.notify(`Could not extract scaffold template for ${artifact}`, "error");
		postCommandOutput(pi, `OpenSpec instructions for ${artifact} (${change})`, result.combined);
		return undefined;
	}

	if ((await pathExists(outputPath)) && !force) {
		let overwrite = false;
		if (ctx.hasUI) {
			overwrite = await ctx.ui.confirm("Overwrite existing file?", `${outputPath} already exists. Replace it with the OpenSpec template?`);
		}
		if (!overwrite) {
			ctx.ui.notify(`Skipped ${artifact}; file already exists`, "warning");
			postCommandOutput(pi, `OpenSpec instructions for ${artifact} (${change})`, result.combined);
			return outputPath;
		}
	}

	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, `${template}\n`, "utf8");
	ctx.ui.notify(`Scaffolded ${artifact}: ${path.relative(ctx.cwd, outputPath)}`, "success");
	postCommandOutput(pi, `Scaffolded OpenSpec ${artifact} for ${change}`, [`Path: ${path.relative(ctx.cwd, outputPath)}`, "", template].join("\n"));
	return outputPath;
}

function parseCapabilityBullets(proposalText: string, heading: "New Capabilities" | "Modified Capabilities") {
	const sectionMatch = proposalText.match(new RegExp(`### ${heading}([\\s\\S]*?)(?:\\n### |$)`, "i"));
	if (!sectionMatch) return [] as Array<{ name: string; description: string }>;
	return sectionMatch[1]
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.replace(/^-\s+/, ""))
		.filter((line) => !line.startsWith("`<") && !line.startsWith("<"))
		.map((line) => {
			const [namePart, ...descParts] = line.split(":");
			return { name: namePart.replace(/`/g, "").trim(), description: descParts.join(":").trim() };
		})
		.filter((item) => /^[a-z0-9-]+$/.test(item.name));
}

async function scaffoldSpecDeltasFromProposal(pi: ExtensionAPI, ctx: CommandCtx, change: string, force = false) {
	const proposalPath = path.join(ctx.cwd, "openspec", "changes", change, "proposal.md");
	if (!(await pathExists(proposalPath))) {
		ctx.ui.notify(`Proposal not found: ${path.relative(ctx.cwd, proposalPath)}`, "error");
		return;
	}
	const proposalText = await fs.readFile(proposalPath, "utf8");
	const newCapabilities = parseCapabilityBullets(proposalText, "New Capabilities");
	const modifiedCapabilities = parseCapabilityBullets(proposalText, "Modified Capabilities");
	const capabilities = [
		...newCapabilities.map((item) => ({ ...item, mode: "new" as const })),
		...modifiedCapabilities.map((item) => ({ ...item, mode: "modified" as const })),
	];
	if (capabilities.length === 0) {
		ctx.ui.notify("No concrete capabilities found in proposal.md", "warning");
		return;
	}

	const created: string[] = [];
	for (const capability of capabilities) {
		const specPath = path.join(ctx.cwd, "openspec", "changes", change, "specs", capability.name, "spec.md");
		if ((await pathExists(specPath)) && !force) continue;
		await fs.mkdir(path.dirname(specPath), { recursive: true });
		const content = capability.mode === "new"
			? `# ${capability.name} Specification\n\n## Purpose\n\n${capability.description || "Describe this capability."}\n\n## Requirements\n\n### Requirement: ${capability.name}\n\nThe system SHALL ${capability.description || "provide this capability"}.\n\n#### Scenario: Basic behavior\n\n- **GIVEN** the capability is invoked\n- **WHEN** the expected action occurs\n- **THEN** the system SHALL satisfy the requirement\n`
			: `# ${capability.name} Specification Delta\n\n## Modified Requirements\n\n### Requirement: ${capability.name}\n\n${capability.description || "Describe the requirement change."}\n\n#### Scenario: Updated behavior\n\n- **GIVEN** the existing capability is in use\n- **WHEN** the new change is applied\n- **THEN** the system SHALL satisfy the updated requirement\n`;
		await fs.writeFile(specPath, content, "utf8");
		created.push(path.relative(ctx.cwd, specPath));
	}

	if (created.length === 0) {
		ctx.ui.notify("No spec delta files created (existing files left untouched)", "info");
		return;
	}
	ctx.ui.notify(`Scaffolded ${created.length} spec delta file(s)`, "success");
	postCommandOutput(pi, `Scaffolded OpenSpec spec deltas for ${change}`, created.join("\n"));
}

async function readArchivedChange(change: string, cwd: string) {
	const base = path.join(cwd, "openspec", "changes", "archive", change);
	if (!(await pathExists(base))) return undefined;
	const parts: string[] = [`# Archived change: ${change}`];
	for (const fileName of ["proposal.md", "design.md", "tasks.md", "README.md"]) {
		const filePath = path.join(base, fileName);
		if (!(await pathExists(filePath))) continue;
		parts.push(`\n## ${fileName}\n`);
		parts.push(await fs.readFile(filePath, "utf8"));
	}
	return parts.join("\n");
}

function buildDraftPrompt(params: {
	artifact: "proposal" | "design" | "tasks";
	change: string;
	targetPath: string;
	sourcePaths: string[];
}) {
	const sourceList = params.sourcePaths.map((sourcePath) => `- @${sourcePath}`).join("\n");
	if (params.artifact === "proposal") {
		return [
			`Draft @${params.targetPath} for OpenSpec change \"${params.change}\".`,
			"Use these PRD-style/source docs as primary input:",
			sourceList,
			"",
			"Also read the current OpenSpec specs in @openspec/specs/ as needed to determine whether this change introduces new capabilities or modifies existing ones.",
			"Populate the proposal with concrete content, replacing placeholder comments/template bullets.",
			"Keep the structure already in the file, but rewrite it into a real proposal.",
			"Be explicit in the Capabilities section and use existing spec names when describing modified capabilities.",
		].join("\n");
	}
	if (params.artifact === "design") {
		return [
			`Draft @${params.targetPath} for OpenSpec change \"${params.change}\".`,
			"Use these PRD-style/source docs as primary input:",
			sourceList,
			"",
			`Also read @openspec/changes/${params.change}/proposal.md and relevant files under @openspec/specs/ before drafting the design.`,
			"Populate the design with concrete content, replacing placeholder comments/template bullets.",
			"Keep the structure already in the file, but rewrite it into a real technical design focused on approach, decisions, risks, and non-goals.",
		].join("\n");
	}
	return [
		`Draft @${params.targetPath} for OpenSpec change \"${params.change}\".`,
		"Use these PRD-style/source docs as primary input:",
		sourceList,
		"",
		`Also read @openspec/changes/${params.change}/proposal.md, @openspec/changes/${params.change}/design.md, and relevant files under @openspec/specs/ before drafting the tasks.`,
		"Populate the tasks file with concrete implementation and verification steps, replacing placeholder comments/template bullets.",
		"Keep the structure already in the file, but rewrite it into an actionable checklist with grouped tasks and numbered sub-tasks.",
	].join("\n");
}

export default function openSpecExtension(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const state = await getOpenSpecState(ctx.cwd);
		if (!state) return;
		ctx.ui.setStatus("openspec", `OpenSpec: ${state.specs.length} specs, ${state.changes.length} active changes${state.archivedChanges.length ? `, ${state.archivedChanges.length} archived` : ""}`);
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const state = await getOpenSpecState(ctx.cwd);
		if (!state) return;
		return {
			message: {
				customType: "openspec-context",
				content: [
					"OpenSpec project detected.",
					`Specs: ${state.specs.join(", ") || "none"}`,
					`Active changes: ${state.changes.join(", ") || "none"}`,
					state.archivedChanges.length ? `Archived changes: ${state.archivedChanges.join(", ")}` : undefined,
					"Prefer the openspec_cli tool or /osp-* commands for OpenSpec operations.",
				].filter(Boolean).join("\n"),
				display: false,
			},
		};
	});

	pi.registerTool({
		name: "openspec_cli",
		label: "OpenSpec CLI",
		description: "Run common OpenSpec CLI operations against the current repository.",
		promptSnippet: "Inspect and manage OpenSpec specs and change proposals using the local openspec CLI.",
		promptGuidelines: [
			"Use openspec_cli when the user asks about OpenSpec specs, changes, validation, status, or creating a new change.",
			"Prefer openspec_cli over raw bash for OpenSpec operations so output is normalized.",
		],
		parameters: OPEN_SPEC_TOOL_PARAMETERS,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const state = await getOpenSpecState(ctx.cwd);
			if (!state && params.action !== "init") {
				return {
					content: [{ type: "text", text: "No openspec/ directory found in the current working directory." }],
					details: { ok: false },
					isError: true,
				};
			}
			const args = buildOpenSpecArgs(params);
			const result = await runOpenSpec(ctx.cwd, args);
			return {
				content: [{ type: "text", text: result.combined || "OpenSpec command completed with no output." }],
				details: { ok: result.code === 0, command: ["openspec", ...args].join(" "), code: result.code, stdout: result.stdout, stderr: result.stderr },
				isError: result.code !== 0,
			};
		},
	});

	pi.registerCommand("osp-help", {
		description: "Show OpenSpec Pi command help",
		handler: async () => {
			postCommandOutput(pi, "OpenSpec Pi help", [
				"Core:",
				"- /osp-init",
				"- /osp-list [changes|specs]",
				"- /osp-show <name> [change|spec]",
				"- /osp-status [change]",
				"- /osp-validate [--all|<name>] [change|spec]",
				"- /osp-update",
				"- /osp-archive [change] [--skip-specs] [--no-validate]",
				"",
				"Scaffold:",
				"- /osp-proposal [change] [--force]",
				"- /osp-design [change] [--force]",
				"- /osp-tasks [change] [--force]",
				"- /osp-spec-deltas [change] [--force]",
				"",
				"Draft from PRD-style docs:",
				"- /osp-draft-proposal [change] <doc...> [--force]",
				"- /osp-draft-design [change] <doc...> [--force]",
				"- /osp-draft-tasks [change] <doc...> [--force]",
				"",
				"Happy path:",
				"1. /osp-new-change <name> [description]",
				"2. /osp-draft-proposal ...",
				"3. /osp-draft-design ...",
				"4. /osp-draft-tasks ...",
				"5. /osp-spec-deltas",
				"6. /osp-validate <change> change",
			].join("\n"));
		},
	});

	pi.registerCommand("osp-init", {
		description: "Initialize OpenSpec in the current repo: /osp-init",
		handler: async (_args, ctx) => {
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "init" }));
			ctx.ui.notify(result.code === 0 ? "OpenSpec initialized" : "OpenSpec init failed", result.code === 0 ? "success" : "error");
			postCommandOutput(pi, "OpenSpec init", [
				result.combined || "(no output)",
				"",
				"Next steps:",
				"- /osp-list specs",
				"- /osp-list changes",
				"- /osp-validate --all",
				"- /osp-new-change <name> [description]",
				"- /osp-draft-proposal <doc...>   (if you already have a PRD and only one active change later)",
			].join("\n") );
		},
	});

	pi.registerCommand("osp-update", {
		description: "Update OpenSpec instruction files: /osp-update",
		handler: async (_args, ctx) => {
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "update" }));
			ctx.ui.notify(result.code === 0 ? "OpenSpec updated" : "OpenSpec update failed", result.code === 0 ? "success" : "error");
			postCommandOutput(pi, "OpenSpec update", result.combined);
		},
	});

	pi.registerCommand("osp-list", {
		description: "List OpenSpec changes or specs: /osp-list [changes|specs]",
		getArgumentCompletions: (prefix) => toAutocompleteItems(["changes", "specs"], prefix),
		handler: async (args, ctx) => {
			const mode = args.trim() === "specs" ? "specs" : "changes";
			const result = await runOpenSpec(ctx.cwd, ["list", mode === "specs" ? "--specs" : "--changes"]);
			ctx.ui.notify(result.code === 0 ? "OpenSpec list completed" : "OpenSpec list failed", result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec ${mode}`, result.combined);
		},
	});

	pi.registerCommand("osp-show", {
		description: "Show an OpenSpec item: /osp-show <name> [change|spec]",
		getArgumentCompletions: (prefix) => getChangeCompletions(process.cwd(), prefix, true),
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const itemName = parts[0];
			const itemType = parts[1] === "change" || parts[1] === "spec" ? (parts[1] as "change" | "spec") : undefined;
			if (!itemName) {
				ctx.ui.notify("Usage: /osp-show <name> [change|spec]", "warning");
				return;
			}
			const state = await getOpenSpecState(ctx.cwd);
			if (state?.archivedChanges.includes(itemName) && (!itemType || itemType === "change")) {
				const archived = await readArchivedChange(itemName, ctx.cwd);
				if (archived) {
					ctx.ui.notify(`Archived OpenSpec change: ${itemName}`, "success");
					postCommandOutput(pi, `OpenSpec archived change ${itemName}`, archived);
					return;
				}
			}
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "show", itemName, itemType }));
			ctx.ui.notify(result.code === 0 ? `OpenSpec item: ${itemName}` : `OpenSpec show failed: ${itemName}`, result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec show ${itemName}`, result.combined);
		},
	});

	pi.registerCommand("osp-validate", {
		description: "Validate OpenSpec items: /osp-validate [--all|<name>] [change|spec]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const all = parts.includes("--all") || parts.length === 0;
			const itemName = all ? undefined : parts.find((part) => !["change", "spec", "--strict"].includes(part));
			const itemType = parts.includes("change") ? "change" : parts.includes("spec") ? "spec" : undefined;
			const strict = parts.includes("--strict");
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "validate", all, itemName, itemType, strict, json: true }));
			ctx.ui.notify(result.code === 0 ? "OpenSpec validation passed" : "OpenSpec validation failed", result.code === 0 ? "success" : "error");
			postCommandOutput(pi, "OpenSpec validation", result.combined);
		},
	});

	pi.registerCommand("osp-status", {
		description: "Show OpenSpec change artifact status: /osp-status [change]",
		getArgumentCompletions: (prefix) => getChangeCompletions(process.cwd(), prefix),
		handler: async (args, ctx) => {
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(parseArgs(args), state);
			if (!change) {
				ctx.ui.notify("Usage: /osp-status [change] (or have exactly one active change)", "warning");
				return;
			}
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "status", itemName: change, json: true }));
			ctx.ui.notify(result.code === 0 ? `OpenSpec status: ${change}` : `OpenSpec status failed: ${change}`, result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec status ${change}`, result.combined);
		},
	});

	pi.registerCommand("osp-instructions", {
		description: "Show OpenSpec artifact instructions: /osp-instructions <artifact> [change]",
		getArgumentCompletions: (prefix) => toAutocompleteItems(["proposal", "design", "tasks", "specs"], prefix),
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const artifact = parts[0];
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(parts.slice(1), state);
			if (!artifact || !change) {
				ctx.ui.notify("Usage: /osp-instructions <artifact> [change] (or have exactly one active change)", "warning");
				return;
			}
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "instructions", artifact, itemName: change }));
			ctx.ui.notify(result.code === 0 ? `OpenSpec instructions: ${artifact}` : `OpenSpec instructions failed: ${artifact}`, result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec instructions for ${artifact} (${change})`, result.combined);
		},
	});

	pi.registerCommand("osp-new-change", {
		description: "Create a new OpenSpec change: /osp-new-change <name> [description]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const name = parts[0];
			const description = parts.slice(1).join(" ");
			if (!name) {
				ctx.ui.notify("Usage: /osp-new-change <name> [description]", "warning");
				return;
			}
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "new_change", itemName: name, description: description || undefined }));
			ctx.ui.notify(result.code === 0 ? `Created OpenSpec change: ${name}` : `OpenSpec new change failed: ${name}`, result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec new change ${name}`, result.combined);
		},
	});

	pi.registerCommand("osp-archive", {
		description: "Archive a completed OpenSpec change: /osp-archive [change] [--skip-specs] [--no-validate]",
		getArgumentCompletions: (prefix) => getChangeCompletions(process.cwd(), prefix),
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(parts.filter((part) => !part.startsWith("--")), state);
			if (!change) {
				ctx.ui.notify("Usage: /osp-archive [change] [--skip-specs] [--no-validate] (or have exactly one active change)", "warning");
				return;
			}
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "archive", itemName: change, skipSpecs: parts.includes("--skip-specs"), noValidate: parts.includes("--no-validate"), yes: true }));
			ctx.ui.notify(result.code === 0 ? `Archived OpenSpec change: ${change}` : `OpenSpec archive failed: ${change}`, result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec archive ${change}`, result.combined);
		},
	});

	for (const artifact of ["proposal", "design", "tasks"] as const) {
		pi.registerCommand(`osp-${artifact}`, {
			description: `Scaffold ${artifact}.md from OpenSpec instructions: /osp-${artifact} [change] [--force]`,
			getArgumentCompletions: (prefix) => getChangeCompletions(process.cwd(), prefix),
			handler: async (args, ctx) => {
				const parts = parseArgs(args);
				const state = await getOpenSpecState(ctx.cwd);
				const change = resolveChangeArg(parts.filter((part) => part !== "--force"), state);
				if (!change) {
					ctx.ui.notify(`Usage: /osp-${artifact} [change] [--force] (or have exactly one active change)`, "warning");
					return;
				}
				await scaffoldArtifactFromInstructions(pi, ctx as CommandCtx, artifact, change, parts.includes("--force"));
			},
		});
	}

	for (const artifact of ["proposal", "design", "tasks"] as const) {
		pi.registerCommand(`osp-draft-${artifact}`, {
			description: `Scaffold ${artifact}.md and ask Pi to draft it from source docs: /osp-draft-${artifact} [change] <doc...> [--force]`,
			getArgumentCompletions: (prefix) => getDraftArgumentCompletions(process.cwd(), prefix),
			handler: async (args, ctx) => {
				const parts = parseArgs(args);
				const force = parts.includes("--force");
				const state = await getOpenSpecState(ctx.cwd);
				const { change, sourcePaths } = resolveDraftInput(parts.filter((part) => part !== "--force"), state);
				if (!change || sourcePaths.length === 0) {
					ctx.ui.notify(`Usage: /osp-draft-${artifact} [change] <doc...> [--force] (or have exactly one active change)`, "warning");
					return;
				}
				const { normalized, missing } = await validateSourceDocs(ctx.cwd, sourcePaths);
				if (missing.length > 0) {
					ctx.ui.notify(`Missing source docs: ${missing.join(", ")}`, "error");
					return;
				}
				const outputPath = await scaffoldArtifactFromInstructions(pi, ctx as CommandCtx, artifact, change, force);
				if (!outputPath) return;
				const targetPath = path.relative(ctx.cwd, outputPath);
				const prompt = buildDraftPrompt({ artifact, change, targetPath, sourcePaths: normalized });
				await queueDraftPrompt(pi, ctx as CommandCtx, prompt, `${artifact} drafting`);
			},
		});
	}

	pi.registerCommand("osp-spec-deltas", {
		description: "Scaffold change spec files from proposal capabilities: /osp-spec-deltas [change] [--force]",
		getArgumentCompletions: (prefix) => getChangeCompletions(process.cwd(), prefix),
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(parts.filter((part) => part !== "--force"), state);
			if (!change) {
				ctx.ui.notify("Usage: /osp-spec-deltas [change] [--force] (or have exactly one active change)", "warning");
				return;
			}
			await scaffoldSpecDeltasFromProposal(pi, ctx as CommandCtx, change, parts.includes("--force"));
		},
	});
}
