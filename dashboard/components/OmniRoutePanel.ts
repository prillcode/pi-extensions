/** Maestro target order plus provider connection metadata, with scoped polling. */
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { getOmniRouteData, gatewayLabel, type OmniRouteData, type OmniRouteProvider } from "../utils/omniroute.js";
import { formatTokens } from "../utils/format.js";

export class OmniRoutePanel {
	#data: OmniRouteData | undefined;
	#error: string | undefined;
	#loading = false;
	#updated: Date | undefined;
	#details = false;
	#disposed = false;
	#timer: ReturnType<typeof setInterval> | undefined;
	#request: AbortController | undefined;
	constructor(_ctx: ExtensionContext, private changed: () => void, private intervalMs = 30_000) {}
	setActive(active: boolean): void {
		if (this.#disposed) return;
		if (this.#timer) { clearInterval(this.#timer); this.#timer = undefined; }
		if (active) {
			void this.refresh();
			this.#timer = setInterval(() => { void this.refresh(); }, this.intervalMs);
			this.#timer.unref?.();
		} else this.#request?.abort();
	}
	toggleDetails(): void { this.#details = !this.#details; this.changed(); }
	dispose(): void {
		if (this.#disposed) return;
		this.setActive(false); this.#disposed = true; this.#request?.abort();
	}
	async refresh(): Promise<void> {
		if (this.#loading || this.#disposed) return;
		this.#loading = true; this.#error = undefined;
		const request = this.#request = new AbortController();
		this.changed();
		try { this.#data = await getOmniRouteData(request.signal); this.#updated = new Date(); }
		catch (error) { if (!request.signal.aborted) this.#error = error instanceof Error ? error.message : "OmniRoute unavailable"; }
		finally { this.#loading = false; if (this.#request === request) this.#request = undefined; if (!this.#disposed) this.changed(); }
	}
	#badge(provider: OmniRouteProvider, theme: Theme): string {
		const status = `${provider.isActive ? "enabled" : "disabled"} / ${provider.testStatus}`;
		return theme.fg(provider.isActive && provider.testStatus === "active" ? "success" : "warning", status);
	}
	render(theme: Theme, _width: number): string[] {
		const lines = [`  ${theme.bold(theme.fg("accent", "OmniRoute"))} ${gatewayLabel()}`];
		lines.push(theme.fg("dim", `  Auto-refresh 30s · ${this.#updated ? "updated " + this.#updated.toLocaleTimeString() : "not fetched yet"}${this.#loading ? " · refreshing…" : ""}`));
		if (this.#error) lines.push(theme.fg("warning", `  ${this.#error}${this.#data ? " (showing stale data)" : ""}`), "  Check gateway/key; R to retry.");
		if (!this.#data) return [...lines, this.#loading ? "  Loading combos and providers…" : "  No metadata loaded"];
		const combos = this.#data.combos.filter(c => c.name.startsWith("maestro-")).sort((a, b) => a.sortOrder - b.sortOrder);
		lines.push("", theme.bold(`  Maestro combos (${combos.length})`));
		if (!combos.length) lines.push("  No maestro-* combos configured");
		for (const combo of combos) {
			lines.push("", `  ${theme.bold(combo.name)} · ${combo.strategy} · ${formatTokens(combo.computed_context_length)} ctx`);
			if (!combo.models.length) lines.push("    No targets configured");
			combo.models.forEach((target, index) => {
				const providers = this.#data!.providers.filter(p => p.provider === target.providerId);
				// Choose enabled/active first for the compact badge, without losing other connections in detail.
				const primary = [...providers].sort((a, b) => Number(b.isActive && b.testStatus === "active") - Number(a.isActive && a.testStatus === "active") || Number(b.isActive) - Number(a.isActive))[0];
				const weight = target.weight === undefined ? "unknown" : String(target.weight);
				lines.push(`    ${index + 1}. ${target.model}`);
				lines.push(`       ${target.providerId}: ${primary ? this.#badge(primary, theme) : theme.fg("warning", "missing connection")} · weight ${weight}`);
				if (this.#details) {
					lines.push(theme.fg("dim", `       kind ${target.kind} · target ctx ${formatTokens(target.contextLength)} (combo ctx above)`));
					for (const p of providers) lines.push(`       ${p.name} · ${this.#badge(p, theme)} · priority ${p.priority ?? "?"} · backoff ${p.backoffLevel ?? "?"} · tested ${p.lastTested ?? "never"}`);
				}
			});
		}
		lines.push("", theme.bold(`  Provider connections (${this.#data.providers.length})`));
		for (const p of this.#data.providers) lines.push(`    ${p.provider} (${p.name}) · ${this.#badge(p, theme)}`);
		lines.push(theme.fg("dim", "  Stored connection test status, not a live model health probe."));
		return lines;
	}
}
