/**
 * The chats about flows on this computer: each thread's harness session,
 * so a later message resumes it. In memory only: a restart starts a new
 * session for the next message (the person keeps their messages in the
 * browser). Kept in the database later.
 */

export type ChatThread = {
	id: string;
	projectId: string;
	flowName: string;
	/** The profile the session runs on. Another profile starts a new thread. */
	profile: string;
	/** The harness session to resume. Null until the harness names one. */
	sessionId: string | null;
	/** The runs this chat was told about. */
	runIds: Set<string>;
	/** A message is being answered now. */
	busy: boolean;
	usedAt: number;
};

export type ThreadStore = {
	/** The thread, when it is kept and was used within the idle time. */
	get(id: string): ChatThread | null;
	/** A new thread. The one used longest ago goes when there are too many. */
	start(
		fields: Pick<ChatThread, "projectId" | "flowName" | "profile">,
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
				runIds: new Set(),
				busy: false,
				usedAt: now(),
			};
			threads.set(thread.id, thread);
			return thread;
		},
	};
}
