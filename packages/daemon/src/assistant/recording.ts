/**
 * Keeps what each answer of Night Shift's own agents cost: a wrapper
 * around the assistant that reads the usage of each stream and keeps one
 * record when the stream ends. It changes no event and no answer.
 *
 * A stream's `usage` events are a running total of the answer, so the
 * last one is what the answer cost. The record is kept when the stream
 * ends with `done` or `error`, and when the caller stops it. An answer
 * with no usage keeps nothing. The Decider and the Brief writer are not
 * here: they answer inside a run, and the run has their cost.
 */
import type { AnswerCost } from "@nightshift/engine";
import {
	AGENT_ENTRIES,
	type AgentEntryId,
	type AssistantScope,
	type AssistantService,
	type AssistantUsage,
	type ChatEvent,
	type ChatRequest,
	type ExplanationEvent,
	type SuggestionEvent,
} from "@nightshift/flows";
import { now as timeNow } from "@nightshift/time";

export type RecordingDeps = {
	/** Keeps one record. A failure is logged: the answer still reaches the person. */
	keep: (cost: AnswerCost) => Promise<void>;
	/** The project of a run as the Person sees it in the Space. Null when it is not found. */
	projectOfRun: (
		runId: string,
		scope: AssistantScope,
	) => Promise<string | null>;
	now?: () => number;
	/** At most this many chats are remembered as the Improver's. Default 1000. */
	rememberedChats?: number;
};

type AnyEvent = SuggestionEvent | ChatEvent | ExplanationEvent;

/** What a record says besides the usage, the Space, the Person and the time. */
type Answered = Pick<AnswerCost, "agent" | "entry" | "projectId">;

/** Whether the answer used anything: a token, or a cost. */
function spent(usage: AssistantUsage): boolean {
	return (
		usage.inputTokens > 0 || usage.outputTokens > 0 || (usage.costUsd ?? 0) > 0
	);
}

/**
 * The built-in agent a chat request asks for by itself: the agent of its
 * entry, the Improver for a chat about a run, else the Builder. The same
 * rule as the assistant's `chat`.
 */
function entered(request: ChatRequest): "builder" | "improver" {
	const agent = request.entry
		? AGENT_ENTRIES[request.entry].agent
		: request.runId
			? "improver"
			: "builder";
	return agent === "improver" ? "improver" : "builder";
}

/** The assistant `service`, with one record kept per answer that spent something. */
export function recordingAssistant(
	service: AssistantService,
	deps: RecordingDeps,
): AssistantService {
	const now = deps.now ?? timeNow;
	const cap = deps.rememberedChats ?? 1000;
	/**
	 * The chats that became the Improver's, by thread id, the one used
	 * longest ago first. The assistant keeps at most 100 chats, so a chat it
	 * still continues is always among these.
	 */
	const improverChats = new Set<string>();
	const rememberImprover = (threadId: string) => {
		improverChats.delete(threadId);
		improverChats.add(threadId);
		for (const oldest of improverChats) {
			if (improverChats.size <= cap) break;
			improverChats.delete(oldest);
		}
	};

	/**
	 * `stream` as it is. When it ends or the caller stops it, keeps what
	 * its last usage says, with what `answered` says about the answer then.
	 */
	async function* metered<Event extends AnyEvent>(
		stream: AsyncIterable<Event>,
		scope: AssistantScope,
		answered: () => Promise<Answered> | Answered,
		each?: (event: Event) => void,
	): AsyncGenerator<Event> {
		let usage: AssistantUsage | null = null;
		try {
			for await (const event of stream) {
				if (event.type === "usage") usage = event.usage;
				each?.(event);
				yield event;
			}
		} finally {
			if (usage && spent(usage)) {
				try {
					await deps.keep({
						...(await answered()),
						at: now(),
						spaceId: scope.spaceId,
						personId: scope.personId,
						inputTokens: usage.inputTokens,
						outputTokens: usage.outputTokens,
						costUsd: usage.costUsd ?? null,
					});
				} catch (error) {
					console.warn(
						"[assistant] could not keep the cost of an answer",
						error,
					);
				}
			}
		}
	}

	return {
		suggest: (request, signal, scope) =>
			metered(service.suggest(request, signal, scope), scope, () => ({
				agent: "field-writer",
				entry: "field.suggest",
				projectId: request.projectId,
			})),

		chat(request, signal, scope) {
			// The thread's first event says whether the assistant continued the
			// chat the request names. A chat that became the Improver's stays so.
			let agent = entered(request);
			return metered(
				service.chat(request, signal, scope),
				scope,
				() => {
					const entry: AgentEntryId | null =
						request.entry ?? (agent === "builder" ? "flow.build" : null);
					return { agent, entry, projectId: request.projectId };
				},
				(event) => {
					if (event.type !== "thread") return;
					const continued = event.threadId === request.threadId;
					if (continued && improverChats.has(event.threadId)) {
						agent = "improver";
					}
					if (agent === "improver") rememberImprover(event.threadId);
				},
			);
		},

		explain: (runId, signal, scope) =>
			metered(service.explain(runId, signal, scope), scope, async () => ({
				agent: "explainer",
				entry: "run.why",
				projectId: await deps.projectOfRun(runId, scope).catch(() => null),
			})),

		agents: () => service.agents(),
		// A check is a test of the setup: its few cents are not help.
		check: (id, signal) => service.check(id, signal),
	};
}
