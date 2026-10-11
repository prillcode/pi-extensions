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
 * Tiers are named OmniRoute combos. Maestro chooses the tier; OmniRoute chooses the execution
 * provider/model and handles fallback within that combo. Missing combos/auth fail explicitly
 * rather than silently running a different tier.
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
	routine: { provider: "omniroute", id: "maestro-routine" },
	standard: { provider: "omniroute", id: "maestro-standard" },
	complex: { provider: "omniroute", id: "maestro-complex" },
};

/** Tier a standard turn drops to after its first successful edit. */
const WORKHORSE: TierName = "routine";

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

function requireTier(ctx: ExtensionContext, tier: TierName): Model<Api> {
	const { provider, id } = TIERS[tier];
	const model = ctx.modelRegistry.find(provider, id);
	if (!model || !ctx.modelRegistry.hasConfiguredAuth(model)) {
		throw new Error(`Maestro: ${provider}/${id} is missing or has no configured authentication. Check OmniRoute combos and Pi models.json.`);
	}
	return model;
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
		input: ["text"],
		// OmniRoute advertises 1M context and at least 128K output across these combos.
		contextWindow: 1_000_000,
		maxTokens: 128_000,
		async route(request, ctx) {
			// Compaction summaries and other out-of-loop calls never need a senior model.
			if (request.reason === "direct") {
				return routeTo(request, requireTier(ctx, WORKHORSE));
			}

			const previousTier = tierOf(request.previous?.model) ?? request.state?.tier;

			// A new task starts a fresh tier decision. Short approvals reuse the last branch tier.
			if (request.reason === "user") {
				const text = lastUserText(request.messages).trim();
				const chosen =
					previousTier && APPROVAL.test(text) ? previousTier : await classifyTier(request, ctx);
				return routeTo(request, requireTier(ctx, chosen), { tier: chosen });
			}

			const state = request.state;
			if (!state) {
				// The extension was enabled mid-turn: follow the tier already answering, else standard.
				const chosen = previousTier ?? tierOf(request.failed?.model) ?? "standard";
				return routeTo(request, requireTier(ctx, chosen), { tier: chosen });
			}

			// A standard turn made its first edit: let the workhorse finish the implementation.
			// Retries stay on the failed tier; only a successful continuation can change phases.
			if (request.reason === "continuation" && state.tier === "standard" && editedThisTurn(request.messages)) {
				return routeTo(request, requireTier(ctx, WORKHORSE), { tier: WORKHORSE });
			}

			// Keep the same combo on continuations and retries; OmniRoute owns execution fallback.
			return routeTo(request, requireTier(ctx, state.tier));
		},
	});
}
