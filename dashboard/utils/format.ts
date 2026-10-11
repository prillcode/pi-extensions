/** Compact token counts, including Pi's unknown-after-compaction state. */
export function formatTokens(value: number | null | undefined): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return "unknown";
	if (value < 1_000) return String(value);
	if (value < 1_000_000) return `${(value / 1_000).toFixed(1)}k`;
	return `${(value / 1_000_000).toFixed(1)}M`;
}
