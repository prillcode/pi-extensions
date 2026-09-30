/**
 * Maestro — a virtual model that routes each turn across model tiers by task difficulty.
 *
 * Select it as `router/maestro`. For each new user message it classifies the requested work
 * with TypeSafe's Jev (via the already-authenticated OpenRouter provider) and starts the turn
 * on a tier:
 *
 *   routine  -> the cheap workhorse (search, inspection, tests, docs, mechanical edits)
 *   standard -> the everyday model (ordinary features, fixes, reviews)
 *   complex  -> the senior model (hard debugging, design, concurrency, architecture)
 *
 * The starting model plans and makes the first edit. A standard turn then hands the
 * implementation tail to the workhorse tier, so the cheap model grinds through the rest. A
 * complex turn stays on the senior model, because escalation exists precisely to avoid the
 * wandering a cheaper model would do; a routine turn stays on the workhorse.
 *
 * Continuations and retries reuse the turn's tier so the provider prompt cache stays valid.
 * Compaction and other requests outside the agent loop go to the workhorse. Short approval
 * follow-ups ("continue", "go ahead") keep the previous turn's tier instead of reclassifying.
 *
 * Tiers are configured in TIERS below. Each tier is a { provider, id } pair, so tiers can mix
 * providers freely. If a tier's model has no credentials, FALLBACK_ORDER decides which other
 * tiers to try instead, so a missing key degrades rather than breaking the turn.
 *
 * Usage: `pi --model router/maestro`
 */

import type { Api, Message, Model } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ModelRoute,
	ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------------------------
// Tier configuration
// ---------------------------------------------------------------------------------------------

type TierName = "routine" | "standard" | "complex";

interface TierModel {
	provider: string;
	id: string;
}

/** The model answering each tier. Mix providers freely. */
const TIERS: Record<TierName, TierModel> = {
	routine: { provider: "opencode-go", id: "deepseek-v4-flash" },
	standard: { provider: "openai-codex", id: "gpt-6-luna" },
	complex: { provider: "openai-codex", id: "gpt-6-sol" },
};

/** Tier a standard turn drops to after its first successful edit. */
const WORKHORSE: TierName = "routine";

/** Order in which tiers are tried when the preferred tier has no credentials. */
const FALLBACK_ORDER: Record<TierName, readonly TierName[]> = {
	routine: ["routine", "standard", "complex"],
	standard: ["standard", "complex", "routine"],
	complex: ["complex", "standard", "routine"],
};

/** Jev classifier candidates, first one present in the catalog wins. */
const CLASSIFIER_CANDIDATES: ReadonlyArray<{ provider: string; id: string }> = [
	{ provider: "openrouter", id: "typesafe/jev-1.13" },
	{ provider: "openrouter", id: "~typesafe/jev-latest" },
];

/** Tools whose successful result means implementation has started. */
const EDIT_TOOLS: ReadonlySet<string> = new Set(["edit", "write"]);

/** Hard signals that a task deserves the senior model. */
const COMPLEX_HINTS =
	/\b(architect\w*|redesign|concurren\w*|race condition|deadlock|distributed|migrat\w*|state machine|durable object|websocket|root cause|why (?:is|does|isn'?t|are|did)|investigat\w*|security|vulnerab\w*|regression|optimi[sz]\w*|refactor)\b/i;

/** Signs of mechanical work the workhorse can own outright. */
const ROUTINE_HINTS =
	/\b(rename|typo|format\w*|lint\w*|readme|changelog|docs?|comments?|bump|search|find|grep|list|show me|where is|what does|add (?:a )?test|run (?:the )?(?:tests?|build|lint))\b/i;

/** Short affirmative replies that continue the previous turn rather than starting a new task. */
const APPROVAL =
	/^(?:ok(?:ay)?|yes|yep|yeah|sure|go ahead|go|continue|carry on|proceed|do it|next|keep going|sounds good|perfect|thanks|thank you)[.! ]*$/i;

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

interface MaestroState {
	/** Tier answering the current turn. */
	tier: TierName;
}

type MaestroRequest = ModelRouteRequest<MaestroState>;

const TIER_BY_MODEL = new Map<string, TierName>(
	Object.entries(TIERS).map(([tier, model]) => [`${model.provider}/${model.id}`, tier as TierName]),
);

function tierOf(model?: { provider: string; id: string }): TierName | undefined {
	return model ? TIER_BY_MODEL.get(`${model.provider}/${model.id}`) : undefined;
}

/** First tier in the fallback order whose model exists and has credentials. */
function resolveTier(
	ctx: ExtensionContext,
	name: TierName,
): { tier: TierName; model: Model<Api> } | undefined {
	for (const tier of FALLBACK_ORDER[name]) {
		const config = TIERS[tier];
		const model = ctx.modelRegistry.find(config.provider, config.id);
		if (model && ctx.modelRegistry.hasConfiguredAuth(model)) return { tier, model };
	}
	return undefined;
}

function requireTier(
	ctx: ExtensionContext,
	name: TierName,
): { tier: TierName; model: Model<Api> } {
	const resolved = resolveTier(ctx, name);
	if (!resolved) {
		const wanted = [name, ...FALLBACK_ORDER[name]].map((tier) => {
			const { provider, id } = TIERS[tier];
			return `${provider}/${id}`;
		});
		throw new Error(`Maestro: no configured model for tier "${name}". Check credentials for ${wanted.join(", ")}`);
	}
	return resolved;
}

function routeTo(
	request: MaestroRequest,
	model: Model<Api>,
	state?: MaestroState,
): ModelRoute<MaestroState> {
	return { model, thinkingLevel: request.thinkingLevel, ...(state ? { state } : {}) };
}

function lastUserText(messages: readonly Message[]): string {
	const content = messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
	if (typeof content === "string") return content;
	return content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

/** Whether a tool call since the last user message edited a file successfully. */
function editedThisTurn(messages: readonly Message[]): boolean {
	const lastUser = messages.findLastIndex((message) => message.role === "user");
	return messages
		.slice(lastUser + 1)
		.some(
			(message) =>
				message.role === "toolResult" &&
				EDIT_TOOLS.has(message.toolName) &&
				!message.isError,
		);
}

function heuristicTier(text: string): TierName {
	const trimmed = text.trim();
	if (COMPLEX_HINTS.test(trimmed) || trimmed.length > 4_000) return "complex";
	if (ROUTINE_HINTS.test(trimmed) && trimmed.length < 1_200) return "routine";
	return "standard";
}

/** Classify the requested work into a tier, falling back to the keyword heuristic. */
async function classifyTier(request: MaestroRequest, ctx: ExtensionContext): Promise<TierName> {
	const text = lastUserText(request.messages);
	const jev = CLASSIFIER_CANDIDATES.map((candidate) =>
		ctx.modelRegistry.findOfType("classifier", candidate.provider, candidate.id),
	).find((model) => model !== undefined);

	if (jev) {
		try {
			const result = await ctx.modelRegistry.classify(
				jev,
				{
					state: { prompt: text.slice(0, 16_000) },
					questions: {
						tier: {
							type: "choice",
							instructions:
								"How demanding is the software engineering work requested in `prompt`?",
							criteria: {
								routine:
									"Search, inspection, tests, docs, or a mechanical edit with an obvious answer",
								standard: "An ordinary feature, fix, or review that needs some judgment",
								complex:
									"Subtle design, a cross-cutting change, hard debugging, concurrency, or architecture",
							},
						},
					},
				},
				{ signal: request.signal },
			);
			const answer = result.stopReason === "stop" ? result.answers.tier : undefined;
			if (answer?.type === "choice") {
				if (answer.choice === "routine") return "routine";
				if (answer.choice === "complex") return "complex";
				if (answer.choice === "standard") return "standard";
			}
		} catch {
			// Classifier unreachable or unauthenticated: use the heuristic.
		}
	}

	return heuristicTier(text);
}

export default function (pi: ExtensionAPI) {
	pi.registerVirtualModel<MaestroState>({
		provider: "router",
		id: "maestro",
		name: "Maestro",
		thinkingLevels: ["low", "medium", "high", "xhigh"],
		// Smallest window across the configured tiers; shown before the first response.
		contextWindow: 272_000,
		maxTokens: 128_000,
		async route(request, ctx) {
			// Compaction summaries and other out-of-loop calls never need a senior model.
			if (request.reason === "direct") {
				const { tier, model } = requireTier(ctx, WORKHORSE);
				return routeTo(request, model, { tier });
			}

			const previousTier = tierOf(request.previous?.model);

			// A new task starts a fresh tier decision.
			if (request.reason === "user") {
				const text = lastUserText(request.messages).trim();
				const chosen =
					previousTier && APPROVAL.test(text) ? previousTier : await classifyTier(request, ctx);
				const { tier, model } = requireTier(ctx, chosen);
				return routeTo(request, model, { tier });
			}

			const state = request.state;
			if (!state) {
				// The extension was enabled mid-turn: follow the tier already answering, else standard.
				const chosen = previousTier ?? tierOf(request.failed?.model) ?? "standard";
				const { tier, model } = requireTier(ctx, chosen);
				return routeTo(request, model, { tier });
			}

			// A standard turn made its first edit: let the workhorse finish the implementation.
			if (state.tier === "standard" && editedThisTurn(request.messages)) {
				const workhorse = resolveTier(ctx, WORKHORSE);
				if (workhorse) return routeTo(request, workhorse.model, { tier: workhorse.tier });
			}

			// Otherwise stay on the turn's tier to keep the prompt cache warm.
			const { tier, model } = requireTier(ctx, state.tier);
			return tier === state.tier ? routeTo(request, model) : routeTo(request, model, { tier });
		},
	});
}
