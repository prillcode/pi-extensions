/**
 * Maestro — a virtual model that routes each turn across the OpenAI Codex tiers.
 *
 * Select it as `router/maestro`. For each new user message it classifies the requested work
 * with TypeSafe's Jev (via the already-authenticated OpenRouter provider) and starts the turn
 * on a tier:
 *
 *   routine  -> gpt-5.6-luna   search, inspection, tests, docs, mechanical edits
 *   standard -> gpt-5.6-terra  ordinary features, fixes, reviews
 *   complex  -> gpt-5.6-sol    hard debugging, design, concurrency, architecture
 *
 * The starting model plans and makes the first edit. A Terra turn then hands the implementation
 * tail to Luna, so the cheap workhorse grinds through the rest. Sol stays for the whole turn,
 * because escalation exists precisely to avoid the wandering a cheaper model would do; Luna
 * stays on Luna.
 *
 * Continuations and retries reuse the turn's model so the provider prompt cache stays valid.
 * Compaction and other requests outside the agent loop go to Luna. Short approval follow-ups
 * ("continue", "go ahead") keep the previous turn's tier instead of reclassifying.
 *
 * Tuning lives in the constants below. Set CLASSIFIER_CANDIDATES to [] to force the keyword
 * heuristic (useful if Jev is ever unavailable).
 *
 * Usage: `pi --model router/maestro`
 */

import type { Message } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	ModelRoute,
	ModelRouteRequest,
} from "@earendil-works/pi-coding-agent";

const PROVIDER = "openai-codex";
const LUNA = "gpt-5.6-luna";
const TERRA = "gpt-5.6-terra";
const SOL = "gpt-5.6-sol";
const TIERS: ReadonlySet<string> = new Set([LUNA, TERRA, SOL]);

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

interface MaestroState {
	/** Codex model id answering the current turn. */
	model: string;
}

type MaestroRequest = ModelRouteRequest<MaestroState>;

function routeTo(
	request: MaestroRequest,
	ctx: ExtensionContext,
	id: string,
	state?: MaestroState,
): ModelRoute<MaestroState> {
	const model = ctx.modelRegistry.find(PROVIDER, id);
	if (!model) throw new Error(`Model ${PROVIDER}/${id} is not in the catalog`);
	return { model, thinkingLevel: request.thinkingLevel, state };
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

function heuristicTier(text: string): string {
	const trimmed = text.trim();
	if (COMPLEX_HINTS.test(trimmed) || trimmed.length > 4_000) return SOL;
	if (ROUTINE_HINTS.test(trimmed) && trimmed.length < 1_200) return LUNA;
	return TERRA;
}

/** Classify the requested work into a starting tier, falling back to the keyword heuristic. */
async function classifyTier(request: MaestroRequest, ctx: ExtensionContext): Promise<string> {
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
				if (answer.choice === "routine") return LUNA;
				if (answer.choice === "complex") return SOL;
				if (answer.choice === "standard") return TERRA;
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
		// Shared by all three Codex tiers; shown before the first response.
		contextWindow: 272_000,
		maxTokens: 128_000,
		async route(request, ctx) {
			// Compaction summaries and other out-of-loop calls never need a senior model.
			if (request.reason === "direct") return routeTo(request, ctx, LUNA);

			const previousTier =
				request.previous?.model.provider === PROVIDER &&
				TIERS.has(request.previous.model.id)
					? request.previous.model.id
					: undefined;

			// A new task starts a fresh tier decision.
			if (request.reason === "user") {
				const text = lastUserText(request.messages).trim();
				if (previousTier && APPROVAL.test(text)) {
					return routeTo(request, ctx, previousTier, { model: previousTier });
				}
				const model = await classifyTier(request, ctx);
				return routeTo(request, ctx, model, { model });
			}

			const state = request.state;
			if (!state) {
				// The extension was enabled mid-turn: follow the tier already answering, else Terra.
				const id =
					previousTier ??
					(request.failed?.model.provider === PROVIDER && TIERS.has(request.failed.model.id)
						? request.failed.model.id
						: TERRA);
				return routeTo(request, ctx, id, { model: id });
			}

			// Terra planned and has made the first edit: let Luna finish the implementation.
			if (state.model === TERRA && editedThisTurn(request.messages)) {
				return routeTo(request, ctx, LUNA, { model: LUNA });
			}

			// Otherwise stay on the turn's model to keep the prompt cache warm.
			return routeTo(request, ctx, state.model);
		},
	});
}
