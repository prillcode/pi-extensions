/**
 * BrainPanel Component - View project brain memory + brain-sync actions
 */

import type { ExtensionContext, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Text, SelectList, truncateToWidth, visibleWidth, type SelectItem } from "@mariozechner/pi-tui";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
	resolveBrainProject,
	listBrainFiles,
	readBrainFile,
	getPriorityFiles,
	type BrainProject,
	type BrainFile,
} from "../utils/brain.js";

const BRAIN_SYNC_COMMANDS = [
	{ value: "init", label: "Init brain", description: "Create brain project for this repo" },
	{ value: "status", label: "Status", description: "Check brain project health" },
	{ value: "load", label: "Load context", description: "Load brain context for session" },
	{ value: "log", label: "Log progress", description: "Record today's work" },
	{ value: "state", label: "Update state", description: "Update state/now.md" },
	{ value: "learn", label: "Capture learnings", description: "Promote insights to wiki" },
	{ value: "end", label: "End session", description: "End-of-session wrap-up" },
	{ value: "commit-sync", label: "Commit & sync", description: "Commit and push brain changes" },
];

export class BrainPanel {
	#ctx: ExtensionContext;
	#pi: ExtensionAPI;
	#onRefresh: () => void;
	#onClose: () => void;
	#project: BrainProject;
	#files: BrainFile[] = [];
	#viewingFile: BrainFile | null = null;
	#fileContent: string | null = null;

	constructor(ctx: ExtensionContext, pi: ExtensionAPI, onRefresh: () => void, onClose?: () => void) {
		this.#ctx = ctx;
		this.#pi = pi;
		this.#onRefresh = onRefresh;
		this.#onClose = onClose || (() => {});
		this.#project = resolveBrainProject(ctx.cwd);
		if (this.#project.exists) {
			this.#files = getPriorityFiles(listBrainFiles(this.#project.path));
		}
	}

	handleAction(action: string): void {
		if (action === "back") {
			this.#viewingFile = null;
			this.#fileContent = null;
			this.#onRefresh();
		}
	}

	isViewing(): boolean {
		return this.#viewingFile !== null;
	}

	async viewFile(index: number): Promise<void> {
		const file = this.#files[index];
		if (!file || file.isDirectory) return;

		const content = readBrainFile(file.path);
		if (content === null) {
			this.#ctx.ui.notify(`Could not read ${file.relativePath}`, "error");
			return;
		}

		this.#viewingFile = file;
		this.#fileContent = content;
		this.#onRefresh();
	}

	async showMenu(): Promise<void> {
		try {
			const items: SelectItem[] = [];

		if (!this.#project.exists) {
			items.push({
				value: "brain-sync init",
				label: "Create brain for this repo",
				description: "Run /brain-sync init",
			});
		} else {
			for (const cmd of BRAIN_SYNC_COMMANDS) {
				items.push({
					value: `brain-sync ${cmd.value}`,
					label: cmd.label,
					description: `Run /brain-sync ${cmd.value}`,
				});
			}

			// Add file browsing option
			const nonDirFiles = this.#files.filter((f) => !f.isDirectory);
			if (nonDirFiles.length > 0) {
				items.push({ value: "__separator__", label: "── Files ──", description: "" });
				for (let i = 0; i < Math.min(nonDirFiles.length, 10); i++) {
					const f = nonDirFiles[i]!;
					items.push({
						value: `__file__${i}`,
						label: f.relativePath,
						description: "View this file",
					});
				}
			}
		}

		const result = await this.#ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
			container.addChild(new Text(theme.fg("accent", theme.bold("Brain Actions")), 1, 0));

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

		if (result.startsWith("__file__")) {
			const index = parseInt(result.replace("__file__", ""), 10);
			await this.viewFile(index);
		} else if (result.startsWith("brain-sync")) {
			// Send the command first, then close dashboard
			const command = `/${result}`;
			this.#pi.sendUserMessage(command);
			this.#onClose();
		}
		} catch (error) {
			this.#ctx.ui.notify(`Menu error: ${error}`, "error");
		}
	}

	render(theme: ReturnType<ExtensionContext["ui"]["theme"]>, width: number): string[] {
		if (!this.#project.exists) {
			return this.#renderNoBrain(theme, width);
		}

		if (this.#viewingFile && this.#fileContent !== null) {
			return this.#renderFileView(theme, width);
		}

		return this.#renderFileList(theme, width);
	}

	#renderNoBrain(theme: ReturnType<ExtensionContext["ui"]["theme"]>, _width: number): string[] {
		const lines: string[] = [];
		const accent = (s: string) => theme.fg("accent", s);
		const muted = (s: string) => theme.fg("muted", s);
		const dim = (s: string) => theme.fg("dim", s);
		const bold = (s: string) => theme.bold(s);

		lines.push("");
		lines.push(`  ${bold(accent("No brain found"))}`);
		lines.push(`  ${muted(`No brain project for "${this.#project.slug}"`)}`);
		lines.push("");
		lines.push(`  ${dim("Press M to see options, or use the skill directly:")}`);
		lines.push(`  ${accent("/brain-sync init")}`);
		lines.push("");
		lines.push(`  ${dim("This will scaffold: state/now.md, wiki/, log/, raw/")}`);
		lines.push(`  ${dim("in ../brain/projects/${this.#project.slug}/")}`);

		return lines;
	}

	#renderFileList(theme: ReturnType<ExtensionContext["ui"]["theme"]>, width: number): string[] {
		const lines: string[] = [];
		const accent = (s: string) => theme.fg("accent", s);
		const muted = (s: string) => theme.fg("muted", s);
		const dim = (s: string) => theme.fg("dim", s);
		const success = (s: string) => theme.fg("success", s);
		const bold = (s: string) => theme.bold(s);

		lines.push(`  ${bold(accent(`Brain: ${this.#project.slug}`))}`);

		const indicators: string[] = [];
		if (this.#project.hasNow) indicators.push(success("✓ now.md"));
		if (this.#project.hasWiki) indicators.push(success("✓ wiki/"));
		if (this.#project.hasLog) indicators.push(success("✓ log/"));
		if (indicators.length > 0) {
			lines.push(`  ${indicators.join(dim(" · "))}`);
		}
		lines.push("");

		lines.push(`  ${bold("Files:")}`);

		const prefix = "    ";
		let fileIndex = 0;
		for (const file of this.#files) {
			if (file.isDirectory) {
				lines.push(`${prefix}${dim("📁 " + file.relativePath + "/")}`);
			} else {
				const sizeStr = file.size > 1024 ? `${(file.size / 1024).toFixed(1)}k` : `${file.size}b`;
				const num = `[${fileIndex}]`;
				const isPriority = ["state/now.md", "wiki/index.md"].includes(file.relativePath);
				const label = isPriority ? accent(`${num} ${file.relativePath}`) : muted(`${num} ${file.relativePath}`);
				const meta = dim(` (${sizeStr})`);
				lines.push(`${prefix}${label}${meta}`);
				fileIndex++;
			}
		}

		return lines;
	}

	#renderFileView(theme: ReturnType<ExtensionContext["ui"]["theme"]>, width: number): string[] {
		const lines: string[] = [];
		const accent = (s: string) => theme.fg("accent", s);
		const dim = (s: string) => theme.fg("dim", s);
		const bold = (s: string) => theme.bold(s);

		lines.push(`  ${bold(accent(this.#viewingFile!.relativePath))}`);
		lines.push(dim("─".repeat(width)));
		lines.push("");

		const maxLines = 30;
		const contentLines = this.#fileContent!.split("\n");

		for (let i = 0; i < Math.min(contentLines.length, maxLines); i++) {
			const line = contentLines[i];
			if (line === undefined) break;
			lines.push(truncateToWidth(`  ${line}`, width));
		}

		if (contentLines.length > maxLines) {
			lines.push("");
			lines.push(dim(`  ...${contentLines.length - maxLines} more lines`));
		}

		return lines;
	}
}
