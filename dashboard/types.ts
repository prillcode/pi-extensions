/**
 * Dashboard Extension - Shared Types
 */

export interface TodoItem {
	id: string;
	text: string;
	done: boolean;
}

export type DashboardTab = "tasks" | "sessions" | "git" | "brain" | "info";
