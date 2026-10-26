/**
 * The chats about flows on this computer: each thread's harness session,
 * so a later message resumes it, and the conversation so far, so a new
 * session (on another agent) can take it over. In memory only: a restart
 * starts a new session for the next message (the person keeps their
 * messages in the browser). Kept in the database later.
 */
import type { ChatExchange } from "@nightshift/agents";
import type { AgentProfileSettings } from "@nightshift/flows";

/** The agent a thread's session runs on. */
export type ThreadAgent = Pick<
	AgentProfileSettings,
	"harness" | "model" | "effort"
>;

/** At most this many exchanges carry over to a new session. */
const KEPT_EXCHANGES = 20;
/** An answer that carries over keeps at most this many characters. */
const KEPT_ANSWER_CHARS = 4000;

export type ChatThread = {
	id: string;
	projectId: string;
	flowName: string;
	/** The agent the session runs on. Another agent may need a new session. */
	agent: ThreadAgent;
	/** The harness session to resume. Null until the harness names one. */
	sessionId: string | null;
	/** The messages and answers so far, oldest first, for a new session. */
	exchanges: ChatExchange[];
	/** The runs this chat was told about. */
	runIds: Set<string>;
	/** A message is being answered now. */
	busy: boolean;
	usedAt: number;
};

/**
 * Keeps one message and its answer on the thread: the last
 * `KEPT_EXCHANGES`, each answer cut to `KEPT_ANSWER_CHARS`.
 */
export function keepExchange(thread: ChatThread, exchange: ChatExchange): void {
	const answer =
		exchange.answer.length > KEPT_ANSWER_CHARS
			? `${exchange.answer.slice(0, KEPT_ANSWER_CHARS)}…`
			: exchange.answer;
	thread.exchanges.push({ message: exchange.message, answer });
	if (thread.exchanges.length > KEPT_EXCHANGES) {
		thread.exchanges.splice(0, thread.exchanges.length - KEPT_EXCHANGES);
	}
}

export type ThreadStore = {
	/** The thread, when it is kept and was used within the idle time. */
	get(id: string): ChatThread | null;
	/** A new thread. The one used longest ago goes when there are too many. */
	start(
		fields: Pick<ChatThread, "projectId" | "flowName" | "agent">,
	): ChatThread;
};

export type ThreadStoreOptions = {
	/** At most this many threads. Default 100. */
	cap?: number;
	/** A thread not used for this long is forgotten. Default six hours. */
	idleMs?: number;
	now?: () => number;
};

export function createThreadStore(
	options: ThreadStoreOptions = {},
): ThreadStore {
	const cap = options.cap ?? 100;
	const idleMs = options.idleMs ?? 6 * 60 * 60 * 1000;
	const now = options.now ?? Date.now;
	const threads = new Map<string, ChatThread>();

	const expire = () => {
		const at = now();
		for (const [id, thread] of threads) {
			if (!thread.busy && at - thread.usedAt > idleMs) threads.delete(id);
		}
	};

	return {
		get(id) {
			expire();
			const thread = threads.get(id) ?? null;
			if (thread) thread.usedAt = now();
			return thread;
		},
		start(fields) {
			expire();
			while (threads.size >= cap) {
				let oldest: ChatThread | null = null;
				for (const thread of threads.values()) {
					if (!oldest || thread.usedAt < oldest.usedAt) oldest = thread;
				}
				if (!oldest) break;
				threads.delete(oldest.id);
			}
			const thread: ChatThread = {
				...fields,
				id: crypto.randomUUID(),
				sessionId: null,
				exchanges: [],
				runIds: new Set(),
				busy: false,
				usedAt: now(),
			};
			threads.set(thread.id, thread);
			return thread;
		},
	};
}
