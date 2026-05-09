import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { promises as fs } from "node:fs";
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

const OPEN_SPEC_TOOL_PARAMETERS = Type.Object({
	action: Type.Union(
		[
			Type.Literal("init"),
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
});

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function listChildDirectories(targetPath: string): Promise<string[]> {
	if (!(await pathExists(targetPath))) return [];
	const entries = await fs.readdir(targetPath, { withFileTypes: true });
	return entries
		.filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
		.map((entry) => entry.name)
		.sort();
}

async function getOpenSpecState(cwd: string): Promise<RepoOpenSpecState | undefined> {
	const rootDir = path.join(cwd, "openspec");
	if (!(await pathExists(rootDir))) return undefined;
	const specs = await listChildDirectories(path.join(rootDir, "specs"));
	const changes = (await listChildDirectories(path.join(rootDir, "changes"))).filter((name) => name !== "archive");
	const archivedChangesRoot = path.join(rootDir, "changes", "archive");
	const archivedChanges = await listChildDirectories(archivedChangesRoot);
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
}): string[] {
	switch (params.action) {
		case "init":
			return ["init", ".", "--tools", "pi", "--force"];
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
			if (params.all) {
				args.push("--all");
			} else if (params.itemName) {
				args.push(params.itemName);
			}
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

		child.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
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

async function scaffoldArtifactFromInstructions(
	pi: ExtensionAPI,
	ctx: { cwd: string; hasUI: boolean; ui: { notify: (message: string, level?: "info" | "success" | "warning" | "error") => void; confirm: (title: string, message: string) => Promise<boolean> } },
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
	postCommandOutput(
		pi,
		`Scaffolded OpenSpec ${artifact} for ${change}`,
		[`Path: ${path.relative(ctx.cwd, outputPath)}`, "", template].join("\n"),
	);
	return outputPath;
}

function resolveChangeArg(args: string[], state?: RepoOpenSpecState): string | undefined {
	const explicit = args.find((part) => !part.startsWith("--"));
	if (explicit) return explicit;
	if (state?.changes.length === 1) return state.changes[0];
	return undefined;
}

function parseCapabilityBullets(proposalText: string, heading: "New Capabilities" | "Modified Capabilities") {
	const sectionMatch = proposalText.match(new RegExp(`### ${heading}([\\s\\S]*?)(?:\n### |$)`, "i"));
	if (!sectionMatch) return [] as Array<{ name: string; description: string }>;
	return sectionMatch[1]
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "))
		.map((line) => line.replace(/^-\s+/, ""))
		.filter((line) => !line.startsWith("`<") && !line.startsWith("<"))
		.map((line) => {
			const [namePart, ...descParts] = line.split(":");
			return {
				name: namePart.replace(/`/g, "").trim(),
				description: descParts.join(":").trim(),
			};
		})
		.filter((item) => /^[a-z0-9-]+$/.test(item.name));
}

async function scaffoldSpecDeltasFromProposal(
	pi: ExtensionAPI,
	ctx: { cwd: string; ui: { notify: (message: string, level?: "info" | "success" | "warning" | "error") => void } },
	change: string,
	force = false,
) {
	const proposalPath = path.join(ctx.cwd, "openspec", "changes", change, "proposal.md");
	if (!(await pathExists(proposalPath))) {
		ctx.ui.notify(`Proposal not found: ${path.relative(ctx.cwd, proposalPath)}`, "error");
		return;
	}
	const proposalText = await fs.readFile(proposalPath, "utf8");
	const newCapabilities = parseCapabilityBullets(proposalText, "New Capabilities");
	const modifiedCapabilities = parseCapabilityBullets(proposalText, "Modified Capabilities");
	const allCapabilities = [
		...newCapabilities.map((item) => ({ ...item, mode: "new" as const })),
		...modifiedCapabilities.map((item) => ({ ...item, mode: "modified" as const })),
	];
	if (allCapabilities.length === 0) {
		ctx.ui.notify("No concrete capabilities found in proposal.md", "warning");
		return;
	}

	const created: string[] = [];
	for (const capability of allCapabilities) {
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
		ctx.ui.setStatus(
			"openspec",
			`OpenSpec: ${state.specs.length} specs, ${state.changes.length} active changes${state.archivedChanges.length ? `, ${state.archivedChanges.length} archived` : ""}`,
		);
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
				]
					.filter(Boolean)
					.join("\n"),
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
				details: {
					ok: result.code === 0,
					command: ["openspec", ...args].join(" "),
					code: result.code,
					stdout: result.stdout,
					stderr: result.stderr,
				},
				isError: result.code !== 0,
			};
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
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const itemName = parts[0];
			const itemType = parts[1] === "change" || parts[1] === "spec" ? (parts[1] as "change" | "spec") : undefined;
			if (!itemName) {
				ctx.ui.notify("Usage: /osp-show <name> [change|spec]", "warning");
				return;
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

	pi.registerCommand("osp-init", {
		description: "Initialize OpenSpec in the current repo: /osp-init",
		handler: async (_args, ctx) => {
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "init" }));
			ctx.ui.notify(result.code === 0 ? "OpenSpec initialized" : "OpenSpec init failed", result.code === 0 ? "success" : "error");
			const nextSteps = [
				"Next steps:",
				"- /osp-list specs",
				"- /osp-list changes",
				"- /osp-validate --all",
				"- /osp-new-change <name> [description]",
			].join("\n");
			postCommandOutput(pi, "OpenSpec init", [result.combined || "(no output)", "", nextSteps].join("\n"));
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

	pi.registerCommand("osp-proposal", {
		description: "Scaffold proposal.md from OpenSpec instructions: /osp-proposal [change] [--force]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(parts.filter((part) => part !== "--force"), state);
			if (!change) {
				ctx.ui.notify("Usage: /osp-proposal [change] [--force] (or have exactly one active change)", "warning");
				return;
			}
			await scaffoldArtifactFromInstructions(pi, ctx, "proposal", change, parts.includes("--force"));
		},
	});

	pi.registerCommand("osp-design", {
		description: "Scaffold design.md from OpenSpec instructions: /osp-design [change] [--force]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(parts.filter((part) => part !== "--force"), state);
			if (!change) {
				ctx.ui.notify("Usage: /osp-design [change] [--force] (or have exactly one active change)", "warning");
				return;
			}
			await scaffoldArtifactFromInstructions(pi, ctx, "design", change, parts.includes("--force"));
		},
	});

	pi.registerCommand("osp-tasks", {
		description: "Scaffold tasks.md from OpenSpec instructions: /osp-tasks [change] [--force]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(parts.filter((part) => part !== "--force"), state);
			if (!change) {
				ctx.ui.notify("Usage: /osp-tasks [change] [--force] (or have exactly one active change)", "warning");
				return;
			}
			await scaffoldArtifactFromInstructions(pi, ctx, "tasks", change, parts.includes("--force"));
		},
	});

	pi.registerCommand("osp-draft-proposal", {
		description: "Scaffold proposal.md and ask Pi to draft it from source docs: /osp-draft-proposal [change] <doc...> [--force]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const force = parts.includes("--force");
			const filtered = parts.filter((part) => part !== "--force");
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(filtered, state);
			const sourcePaths = change === filtered[0] ? filtered.slice(1) : filtered;
			if (!change || sourcePaths.length === 0) {
				ctx.ui.notify("Usage: /osp-draft-proposal [change] <doc...> [--force] (or have exactly one active change)", "warning");
				return;
			}
			const outputPath = await scaffoldArtifactFromInstructions(pi, ctx, "proposal", change, force);
			if (!outputPath) return;
			const targetPath = path.relative(ctx.cwd, outputPath);
			const prompt = buildDraftPrompt({ artifact: "proposal", change, targetPath, sourcePaths });
			ctx.ui.notify(`Queued proposal drafting prompt for ${change}`, "success");
			pi.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("osp-draft-design", {
		description: "Scaffold design.md and ask Pi to draft it from source docs: /osp-draft-design [change] <doc...> [--force]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const force = parts.includes("--force");
			const filtered = parts.filter((part) => part !== "--force");
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(filtered, state);
			const sourcePaths = change === filtered[0] ? filtered.slice(1) : filtered;
			if (!change || sourcePaths.length === 0) {
				ctx.ui.notify("Usage: /osp-draft-design [change] <doc...> [--force] (or have exactly one active change)", "warning");
				return;
			}
			const outputPath = await scaffoldArtifactFromInstructions(pi, ctx, "design", change, force);
			if (!outputPath) return;
			const targetPath = path.relative(ctx.cwd, outputPath);
			const prompt = buildDraftPrompt({ artifact: "design", change, targetPath, sourcePaths });
			ctx.ui.notify(`Queued design drafting prompt for ${change}`, "success");
			pi.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("osp-draft-tasks", {
		description: "Scaffold tasks.md and ask Pi to draft it from source docs: /osp-draft-tasks [change] <doc...> [--force]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const force = parts.includes("--force");
			const filtered = parts.filter((part) => part !== "--force");
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(filtered, state);
			const sourcePaths = change === filtered[0] ? filtered.slice(1) : filtered;
			if (!change || sourcePaths.length === 0) {
				ctx.ui.notify("Usage: /osp-draft-tasks [change] <doc...> [--force] (or have exactly one active change)", "warning");
				return;
			}
			const outputPath = await scaffoldArtifactFromInstructions(pi, ctx, "tasks", change, force);
			if (!outputPath) return;
			const targetPath = path.relative(ctx.cwd, outputPath);
			const prompt = buildDraftPrompt({ artifact: "tasks", change, targetPath, sourcePaths });
			ctx.ui.notify(`Queued tasks drafting prompt for ${change}`, "success");
			pi.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("osp-spec-deltas", {
		description: "Scaffold change spec files from proposal capabilities: /osp-spec-deltas [change] [--force]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const force = parts.includes("--force");
			const state = await getOpenSpecState(ctx.cwd);
			const change = resolveChangeArg(parts.filter((part) => part !== "--force"), state);
			if (!change) {
				ctx.ui.notify("Usage: /osp-spec-deltas [change] [--force] (or have exactly one active change)", "warning");
				return;
			}
			await scaffoldSpecDeltasFromProposal(pi, ctx, change, force);
		},
	});
}
