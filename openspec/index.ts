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
					"Prefer the openspec_cli tool or /openspec-* commands for OpenSpec operations.",
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
			if (!state) {
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

	pi.registerCommand("openspec-list", {
		description: "List OpenSpec changes or specs: /openspec-list [changes|specs]",
		getArgumentCompletions: (prefix) => toAutocompleteItems(["changes", "specs"], prefix),
		handler: async (args, ctx) => {
			const mode = args.trim() === "specs" ? "specs" : "changes";
			const result = await runOpenSpec(ctx.cwd, ["list", mode === "specs" ? "--specs" : "--changes"]);
			ctx.ui.notify(result.code === 0 ? "OpenSpec list completed" : "OpenSpec list failed", result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec ${mode}`, result.combined);
		},
	});

	pi.registerCommand("openspec-show", {
		description: "Show an OpenSpec item: /openspec-show <name> [change|spec]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const itemName = parts[0];
			const itemType = parts[1] === "change" || parts[1] === "spec" ? (parts[1] as "change" | "spec") : undefined;
			if (!itemName) {
				ctx.ui.notify("Usage: /openspec-show <name> [change|spec]", "warning");
				return;
			}
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "show", itemName, itemType }));
			ctx.ui.notify(result.code === 0 ? `OpenSpec item: ${itemName}` : `OpenSpec show failed: ${itemName}`, result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec show ${itemName}`, result.combined);
		},
	});

	pi.registerCommand("openspec-validate", {
		description: "Validate OpenSpec items: /openspec-validate [--all|<name>] [change|spec]",
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

	pi.registerCommand("openspec-status", {
		description: "Show OpenSpec change artifact status: /openspec-status <change>",
		handler: async (args, ctx) => {
			const change = args.trim();
			if (!change) {
				ctx.ui.notify("Usage: /openspec-status <change>", "warning");
				return;
			}
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "status", itemName: change, json: true }));
			ctx.ui.notify(result.code === 0 ? `OpenSpec status: ${change}` : `OpenSpec status failed: ${change}`, result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec status ${change}`, result.combined);
		},
	});

	pi.registerCommand("openspec-instructions", {
		description: "Show OpenSpec artifact instructions: /openspec-instructions <artifact> <change>",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const artifact = parts[0];
			const change = parts[1];
			if (!artifact || !change) {
				ctx.ui.notify("Usage: /openspec-instructions <artifact> <change>", "warning");
				return;
			}
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "instructions", artifact, itemName: change }));
			ctx.ui.notify(result.code === 0 ? `OpenSpec instructions: ${artifact}` : `OpenSpec instructions failed: ${artifact}`, result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec instructions for ${artifact} (${change})`, result.combined);
		},
	});

	pi.registerCommand("openspec-new-change", {
		description: "Create a new OpenSpec change: /openspec-new-change <name> [description]",
		handler: async (args, ctx) => {
			const parts = parseArgs(args);
			const name = parts[0];
			const description = parts.slice(1).join(" ");
			if (!name) {
				ctx.ui.notify("Usage: /openspec-new-change <name> [description]", "warning");
				return;
			}
			const result = await runOpenSpec(ctx.cwd, buildOpenSpecArgs({ action: "new_change", itemName: name, description: description || undefined }));
			ctx.ui.notify(result.code === 0 ? `Created OpenSpec change: ${name}` : `OpenSpec new change failed: ${name}`, result.code === 0 ? "success" : "error");
			postCommandOutput(pi, `OpenSpec new change ${name}`, result.combined);
		},
	});
}
