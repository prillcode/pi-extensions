/** Read-only OmniRoute management client. Only allowlisted metadata leaves this module. */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const OMNIROUTE_BASE_URL = (process.env.OMNIROUTE_BASE_URL || "http://127.0.0.1:20128").replace(/\/+$/, "");
export const gatewayLabel = (): string => {
	try { const url = new URL(OMNIROUTE_BASE_URL); return `${url.protocol}//${url.host}`; }
	catch { return "invalid gateway URL"; }
};
export interface OmniRouteComboModel { model: string; providerId: string; weight?: number; kind?: string; contextLength?: number; }
export interface OmniRouteCombo { name: string; strategy: string; models: OmniRouteComboModel[]; computed_context_length?: number; sortOrder: number; }
export interface OmniRouteProvider { provider: string; name: string; isActive: boolean; testStatus: string; priority?: number; backoffLevel?: number; lastTested?: string; }
export interface OmniRouteData { combos: OmniRouteCombo[]; providers: OmniRouteProvider[]; }
const record = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
// Strip control sequences from server-provided labels, so they cannot drive the terminal.
const label = (value: unknown, fallback = "unknown"): string => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 1024) : fallback;
const number = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
export function parseOmniRouteData(combosPayload: unknown, providersPayload: unknown): OmniRouteData {
	const combos = record(combosPayload).combos, providers = record(providersPayload).connections;
	if (!Array.isArray(combos) || !Array.isArray(providers)) throw new Error("Unexpected OmniRoute metadata response");
	return {
		combos: combos.map(raw => {
			const c = record(raw);
			if (!Array.isArray(c.models)) throw new Error("Unexpected OmniRoute combo targets");
			return {
				name: label(c.name), strategy: label(c.strategy), sortOrder: number(c.sortOrder) ?? 0,
				computed_context_length: number(c.computed_context_length),
				models: c.models.map(raw => { const m = record(raw); const model = label(m.model);
					return { model, providerId: label(m.providerId, model.split("/")[0]), weight: number(m.weight), kind: label(m.kind, "model"), contextLength: number(m.context_length) };
				}),
			};
		}),
		providers: providers.map(raw => { const p = record(raw); return {
			provider: label(p.provider), name: label(p.name), isActive: p.isActive === true,
			testStatus: label(p.testStatus), priority: number(p.priority), backoffLevel: number(p.backoffLevel),
			lastTested: typeof p.lastTested === "string" ? label(p.lastTested) : undefined,
		}; }),
	};
}
async function getJson(path: string, key: string, signal?: AbortSignal): Promise<unknown> {
	let url: URL;
	try { url = new URL(OMNIROUTE_BASE_URL); } catch { throw new Error("Invalid OMNIROUTE_BASE_URL"); }
	if (url.username || url.password || !["http:", "https:"].includes(url.protocol)) throw new Error("Invalid OMNIROUTE_BASE_URL");
	if (url.protocol === "http:" && !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Use HTTPS for a non-local OmniRoute gateway");
	let response: Response;
	try {
		response = await fetch(OMNIROUTE_BASE_URL + path, {
			headers: { Authorization: `Bearer ${key}` }, redirect: "error",
			signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5_000)]) : AbortSignal.timeout(5_000),
		});
	} catch { throw new Error("Gateway unreachable, timed out, or request cancelled"); }
	if (!response.ok) throw new Error(`OmniRoute ${path}: HTTP ${response.status}`);
	try { return await response.json(); } catch { throw new Error("Invalid OmniRoute JSON response"); }
}
export async function getOmniRouteData(signal?: AbortSignal): Promise<OmniRouteData> {
	let key = process.env.OMNIROUTE_MANAGE_KEY?.trim();
	if (!key) {
		try { key = (await readFile(join(homedir(), ".omniroute", "pi.key"), "utf8")).trim(); }
		catch { throw new Error("Manage key unavailable: configure OMNIROUTE_MANAGE_KEY or ~/.omniroute/pi.key"); }
	}
	if (!key) throw new Error("OmniRoute manage key is empty");
	const [combos, providers] = await Promise.all([getJson("/api/combos", key, signal), getJson("/api/providers", key, signal)]);
	return parseOmniRouteData(combos, providers);
}
