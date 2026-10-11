/** Non-blocking git operations. Arguments are never interpolated into a shell. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await exec("git", args, { cwd, encoding: "utf8", timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
	return stdout;
}
export interface GitStatus {
	isRepo: boolean;
	branch: string;
	ahead: number;
	behind: number;
	modified: string[];
	staged: string[];
	untracked: string[];
}
export interface GitCommit { hash: string; message: string; author: string; date: string; }
export async function isGitRepo(cwd: string): Promise<boolean> {
	try { await git(cwd, ["rev-parse", "--git-dir"]); return true; } catch { return false; }
}
export async function getGitStatus(cwd: string): Promise<GitStatus> {
	const result: GitStatus = { isRepo: true, branch: "", ahead: 0, behind: 0, modified: [], staged: [], untracked: [] };
	const [header, files] = await Promise.all([
		git(cwd, ["status", "--porcelain=2", "--branch", "--untracked-files=no"]),
		git(cwd, ["status", "--porcelain", "-z"]),
	]);
	for (const line of header.split("\n")) {
		if (line.startsWith("# branch.head ")) result.branch = line.slice(14);
		if (line.startsWith("# branch.ab ")) {
			const [ahead, behind] = line.slice(12).split(" ");
			result.ahead = Math.abs(Number(ahead)); result.behind = Math.abs(Number(behind));
		}
	}
	const records = files.split("\0");
	for (let i = 0; i < records.length; i++) {
		const line = records[i]!;
		if (!line) continue;
		const status = line.slice(0, 2), file = line.slice(3);
		if (status === "??") result.untracked.push(file);
		else {
			if (status[0] !== " ") result.staged.push(file);
			if (status[1] !== " ") result.modified.push(file);
			if (/[RC]/.test(status)) i++; // -z rename/copy records include the old path next.
		}
	}
	return result;
}
export async function getRecentCommits(cwd: string, count: number): Promise<GitCommit[]> {
	try {
		const output = await git(cwd, ["log", `-n${Math.max(1, Math.floor(count))}`, "--format=%h%x00%s%x00%an%x00%ar"]);
		return output.trimEnd().split("\n").filter(Boolean).map(line => {
			const [hash = "", message = "", author = "", date = ""] = line.split("\0");
			return { hash, message, author, date };
		});
	} catch { return []; } // Repositories without commits are valid.
}
export async function getBranches(cwd: string): Promise<{ name: string; current: boolean }[]> {
	const output = await git(cwd, ["for-each-ref", "--format=%(HEAD)%00%(refname:short)", "refs/heads"]);
	return output.trimEnd().split("\n").filter(Boolean).map(line => {
		const [head, name = ""] = line.split("\0"); return { name, current: head === "*" };
	});
}
export async function checkoutBranch(cwd: string, branch: string): Promise<void> { await git(cwd, ["switch", "--", branch]); }
export async function createBranch(cwd: string, branch: string, checkout = true): Promise<void> {
	await git(cwd, checkout ? ["switch", "-c", branch] : ["branch", "--", branch]);
}
export async function deleteBranch(cwd: string, branch: string, force = false): Promise<void> { await git(cwd, ["branch", force ? "-D" : "-d", "--", branch]); }
export async function stageFile(cwd: string, file: string): Promise<void> { await git(cwd, ["add", "--", file]); }
export async function unstageFile(cwd: string, file: string): Promise<void> { await git(cwd, ["reset", "--", file]); }
