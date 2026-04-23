/**
 * Git utility module - Wrapper around git commands
 */

import { execSync } from "node:child_process";

export interface GitStatus {
	isRepo: boolean;
	branch: string;
	ahead: number;
	behind: number;
	modified: string[];
	staged: string[];
	untracked: string[];
}

export interface GitCommit {
	hash: string;
	message: string;
	author: string;
	date: string;
}

export function isGitRepo(cwd: string): boolean {
	try {
		execSync("git rev-parse --git-dir", { cwd, stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

export function getGitStatus(cwd: string): GitStatus {
	if (!isGitRepo(cwd)) {
		return {
			isRepo: false,
			branch: "",
			ahead: 0,
			behind: 0,
			modified: [],
			staged: [],
			untracked: [],
		};
	}

	try {
		// Get branch and ahead/behind
		let branch = "";
		let ahead = 0;
		let behind = 0;
		try {
			const status = execSync("git status --porcelain=2 --branch", { cwd, stdio: "pipe", encoding: "utf-8" });
			for (const line of status.split("\n")) {
				if (line.startsWith("# branch.head ")) {
					branch = line.slice(13);
				} else if (line.startsWith("# branch.ab ")) {
					const parts = line.slice(12).split(" ");
					ahead = parseInt(parts[0] ?? "0", 10);
					behind = parseInt(parts[1] ?? "0", 10);
				}
			}
		} catch {
			// Fallback to simple branch name
			branch = execSync("git branch --show-current", { cwd, stdio: "pipe", encoding: "utf-8" }).trim();
		}

		// Get file status
		const porcelain = execSync("git status --porcelain", { cwd, stdio: "pipe", encoding: "utf-8" });
		const modified: string[] = [];
		const staged: string[] = [];
		const untracked: string[] = [];

		for (const line of porcelain.split("\n").filter((l) => l.trim())) {
			const status = line.slice(0, 2);
			const file = line.slice(3);

			if (status[0] !== " " && status[0] !== "?") {
				staged.push(file);
			}
			if (status[1] === "M" || status[1] === "D") {
				modified.push(file);
			}
			if (status === "??") {
				untracked.push(file);
			}
		}

		return {
			isRepo: true,
			branch,
			ahead: Math.abs(ahead),
			behind: Math.abs(behind),
			modified,
			staged,
			untracked,
		};
	} catch {
		return {
			isRepo: true,
			branch: "unknown",
			ahead: 0,
			behind: 0,
			modified: [],
			staged: [],
			untracked: [],
		};
	}
}

export function getRecentCommits(cwd: string, count: number): GitCommit[] {
	if (!isGitRepo(cwd)) return [];

	try {
		const format = "%H|%s|%an|%ar";
		const output = execSync(`git log --oneline -n ${count} --format="${format}"`, {
			cwd,
			stdio: "pipe",
			encoding: "utf-8",
		});

		return output
			.split("\n")
			.filter((l) => l.trim())
			.map((line) => {
				const parts = line.split("|");
				return {
					hash: parts[0]?.slice(0, 7) ?? "",
					message: parts[1] ?? "",
					author: parts[2] ?? "",
					date: parts[3] ?? "",
				};
			});
	} catch {
		return [];
	}
}

export function getBranches(cwd: string): { name: string; current: boolean }[] {
	if (!isGitRepo(cwd)) return [];

	try {
		const output = execSync("git branch -a", { cwd, stdio: "pipe", encoding: "utf-8" });
		const branches: { name: string; current: boolean }[] = [];

		for (const line of output.split("\n").filter((l) => l.trim())) {
			const current = line.startsWith("*");
			let name = line.slice(2).trim();

			// Skip detached HEAD
			if (name.startsWith("(HEAD detached")) continue;

			// Remove remotes/ prefix for cleaner display
			if (name.startsWith("remotes/")) {
				name = name.slice(8);
			}

			branches.push({ name, current });
		}

		return branches;
	} catch {
		return [];
	}
}

export function checkoutBranch(cwd: string, branch: string): void {
	execSync(`git checkout "${branch}"`, { cwd, stdio: "pipe" });
}

export function createBranch(cwd: string, branch: string, checkout = true): void {
	if (checkout) {
		execSync(`git checkout -b "${branch}"`, { cwd, stdio: "pipe" });
	} else {
		execSync(`git branch "${branch}"`, { cwd, stdio: "pipe" });
	}
}

export function deleteBranch(cwd: string, branch: string, force = false): void {
	const flag = force ? "-D" : "-d";
	execSync(`git branch ${flag} "${branch}"`, { cwd, stdio: "pipe" });
}

export function stageFile(cwd: string, file: string): void {
	execSync(`git add "${file}"`, { cwd, stdio: "pipe" });
}

export function unstageFile(cwd: string, file: string): void {
	execSync(`git reset HEAD "${file}"`, { cwd, stdio: "pipe" });
}
