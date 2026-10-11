/** Lazy, asynchronous git panel; all subprocesses use argument arrays. */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	getGitStatus, getRecentCommits, getBranches, checkoutBranch, createBranch,
	deleteBranch, stageFile, unstageFile, isGitRepo, type GitStatus, type GitCommit,
} from "../utils/git.js";
import { selectItem, inputText, confirmItem } from "../utils/select.js";

export class GitPanel {
	#status: GitStatus = { isRepo: false, branch: "", ahead: 0, behind: 0, modified: [], staged: [], untracked: [] };
	#commits: GitCommit[] = [];
	#branches: { name: string; current: boolean }[] = [];
	#loading = false;
	#error: string | undefined;
	#disposed = false;
	constructor(private ctx: ExtensionContext, private changed: () => void) {}
	dispose(): void { this.#disposed = true; }
	async refresh(): Promise<void> {
		if (this.#loading || this.#disposed) return;
		this.#loading = true; this.#error = undefined; this.changed();
		try {
			if (!await isGitRepo(this.ctx.cwd)) {
				this.#status = { isRepo: false, branch: "", ahead: 0, behind: 0, modified: [], staged: [], untracked: [] };
				this.#commits = []; this.#branches = [];
			} else {
				[this.#status, this.#commits, this.#branches] = await Promise.all([
					getGitStatus(this.ctx.cwd), getRecentCommits(this.ctx.cwd, 10), getBranches(this.ctx.cwd),
				]);
			}
		} catch (error) { this.#error = error instanceof Error ? error.message : String(error); }
		finally { this.#loading = false; if (!this.#disposed) this.changed(); }
	}
	async handleAction(action: string): Promise<void> {
		if (this.#disposed || this.#loading) return;
		if (action === "refresh") { await this.refresh(); return; }
		if (action === "menu") {
			const selected = await selectItem(this.ctx, "Git Actions", [
				{ value: "checkout", label: "Switch branch" }, { value: "create", label: "Create branch" },
				{ value: "delete", label: "Delete local branch" }, { value: "stage", label: "Stage file" },
				{ value: "unstage", label: "Unstage file" }, { value: "refresh", label: "Refresh status" },
			]);
			if (selected) await this.handleAction(selected);
			return;
		}
		if (!this.#status.isRepo) { this.ctx.ui.notify("Not a git repository", "info"); return; }
		let value: string | null | undefined;
		if (action === "create") value = (await inputText(this.ctx, "New branch name:", ""))?.trim();
		else if (action === "checkout" || action === "delete") {
			value = await selectItem(this.ctx, action === "delete" ? "Delete Branch" : "Switch Branch",
				this.#branches.filter(b => !b.current).map(b => ({ value: b.name, label: b.name })));
		} else if (action === "stage" || action === "unstage") {
			const files = action === "stage" ? [...new Set([...this.#status.modified, ...this.#status.untracked])] : this.#status.staged;
			value = await selectItem(this.ctx, action === "stage" ? "Stage File" : "Unstage File", files.map(file => ({ value: file, label: file })));
		} else return;
		if (!value || this.#disposed) return;
		if (action === "delete") {
			if (!await confirmItem(this.ctx, "Delete branch?", `Delete ${value}?`)) return;
			if (this.#disposed) return;
			try { await deleteBranch(this.ctx.cwd, value); }
			catch {
				if (!await confirmItem(this.ctx, "Force delete?", "Delete failed (possibly unmerged). Force delete this local branch?")) return;
				if (this.#disposed) return;
				await deleteBranch(this.ctx.cwd, value, true);
			}
		} else if (action === "checkout") await checkoutBranch(this.ctx.cwd, value);
		else if (action === "create") await createBranch(this.ctx.cwd, value);
		else if (action === "stage") await stageFile(this.ctx.cwd, value);
		else if (action === "unstage") await unstageFile(this.ctx.cwd, value);
		if (this.#disposed) return;
		this.ctx.ui.notify(`Git ${action} completed`, "info");
		await this.refresh();
	}
	render(theme: Theme, _width: number): string[] {
		if (this.#loading) return ["", "  Loading git status...", ""];
		if (this.#error) return ["", `  Git error: ${this.#error}`, "  Press R to retry."];
		if (!this.#status.isRepo) return ["", "  Not a git repository", ""];
		const status = this.#status;
		const lines = [theme.bold(`  Branch: ${status.branch}`),
			`  Ahead ${status.ahead} · Behind ${status.behind}`, "", theme.bold("  Working Tree:"),
			`    ${status.modified.length} modified · ${status.staged.length} staged · ${status.untracked.length} untracked`, ""];
		if (this.#commits.length) {
			lines.push(theme.bold("  Recent Commits:"));
			for (const commit of this.#commits.slice(0, 5)) lines.push(`    ${theme.fg("dim", commit.hash)} ${commit.message}`);
			lines.push("");
		}
		lines.push(theme.bold("  Local Branches:"));
		for (const branch of this.#branches.slice(0, 8)) lines.push(`    ${branch.current ? "*" : " "} ${branch.name}`);
		if (this.#branches.length > 8) lines.push(`    …${this.#branches.length - 8} more (C to select)`);
		return lines;
	}
}
