/**
 * Brain utility module - Access project brain from ../brain/
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface BrainFile {
	path: string;
	name: string;
	relativePath: string;
	size: number;
	isDirectory: boolean;
}

export interface BrainProject {
	slug: string;
	path: string;
	exists: boolean;
	hasNow: boolean;
	hasWiki: boolean;
	hasLog: boolean;
}

/**
 * Locate the brain repo relative to cwd.
 */
export function findBrainRepo(cwd: string): string | null {
	// Check env var first
	const envPath = process.env.BRAIN_REPO_PATH;
	if (envPath && existsSync(envPath)) return envPath;

	// Check sibling directory
	const sibling = join(cwd, "..", "brain");
	if (existsSync(join(sibling, "AGENTS.md")) && existsSync(join(sibling, "projects"))) {
		return sibling;
	}

	return null;
}

/**
 * Resolve a brain project for the current repo.
 * Uses the directory name as the slug - matching is brain-sync's job.
 */
export function resolveBrainProject(cwd: string): BrainProject {
	const repoName = cwd.split("/").pop() ?? "";
	const brainPath = findBrainRepo(cwd);

	if (!brainPath) {
		return { slug: repoName, path: "", exists: false, hasNow: false, hasWiki: false, hasLog: false };
	}

	const projectPath = join(brainPath, "projects", repoName);
	const exists = existsSync(projectPath) && statSync(projectPath).isDirectory();

	return {
		slug: repoName,
		path: projectPath,
		exists,
		hasNow: exists && existsSync(join(projectPath, "state", "now.md")),
		hasWiki: exists && existsSync(join(projectPath, "wiki")),
		hasLog: exists && existsSync(join(projectPath, "log")),
	};
}

/**
 * List files in a brain project directory (recursive, limited depth).
 */
export function listBrainFiles(projectPath: string, maxDepth = 2): BrainFile[] {
	const files: BrainFile[] = [];

	function walk(dir: string, depth: number) {
		if (depth > maxDepth) return;
		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (entry.name.startsWith(".")) continue;
				const fullPath = join(dir, entry.name);
				if (entry.isDirectory()) {
					files.push({
						path: fullPath,
						name: entry.name,
						relativePath: relative(projectPath, fullPath),
						size: 0,
						isDirectory: true,
					});
					walk(fullPath, depth + 1);
				} else {
					files.push({
						path: fullPath,
						name: entry.name,
						relativePath: relative(projectPath, fullPath),
						size: statSync(fullPath).size,
						isDirectory: false,
					});
				}
			}
		} catch {
			// Permission denied, skip
		}
	}

	walk(projectPath, 0);
	return files;
}

/**
 * Read a brain file's contents.
 */
export function readBrainFile(filePath: string): string | null {
	try {
		return readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}

/**
 * Get the most important brain files to show first.
 */
export function getPriorityFiles(files: BrainFile[]): BrainFile[] {
	const priorityOrder = ["state/now.md", "wiki/index.md", "wiki/learnings.md", "wiki/decisions.md", "wiki/architecture.md"];
	const prioritized: BrainFile[] = [];

	for (const rel of priorityOrder) {
		const found = files.find((f) => f.relativePath === rel && !f.isDirectory);
		if (found) prioritized.push(found);
	}

	// Add remaining non-directory files
	for (const file of files) {
		if (!file.isDirectory && !prioritized.includes(file)) {
			prioritized.push(file);
		}
	}

	return prioritized;
}
