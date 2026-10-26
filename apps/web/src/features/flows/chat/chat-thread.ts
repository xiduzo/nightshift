import type {
	ChatEvent,
	ChatRequest,
	Flow,
	FlowProposal,
} from "@nightshift/flows";

/** What the agent spent on one answer. */
type AssistantUsage = Extract<ChatEvent, { type: "usage" }>["usage"];

/** What the person did with a proposal. */
export type ProposalStatus = "open" | "applied" | "discarded";

/** A proposal in the chat, with the draft it was made from. */
export type ChatProposal = {
	proposal: FlowProposal;
	/** The draft sent with the message, as JSON: Apply warns when the draft changed since. */
	baseJson: string;
	status: ProposalStatus;
};

export type ChatMessage =
	| { id: string; role: "person"; text: string }
	| {
			id: string;
			role: "agent";
			/** The answer so far, as Markdown. */
			text: string;
			proposal?: ChatProposal;
			usage?: AssistantUsage;
			error?: string;
			/** The person stopped the answer. */
			stopped?: boolean;
	  };

export type AgentMessage = Extract<ChatMessage, { role: "agent" }>;

/**
 * A chat about one flow: the thread to continue, and its messages. With
 * `runId` the chat is about that run of the flow, for example one that
 * failed: every message of the chat carries it.
 */
export type ChatThread = {
	threadId?: string;
	runId?: string;
	messages: ChatMessage[];
};

export const EMPTY_THREAD: ChatThread = { messages: [] };

/** A new chat about run `runId`. */
export function aboutRun(runId: string): ChatThread {
	return { runId, messages: [] };
}

/** The first message of a chat about a run that did not finish. */
export const ASK_WHY_MESSAGE =
	"Why did this run not finish? Propose a change to the flow that fixes it.";

/** The request for one message of `thread`: it continues the thread, and keeps its run. */
export function chatRequest(
	thread: ChatThread,
	input: { projectId: string; flowName: string; flow: Flow; message: string },
): ChatRequest {
	return {
		...input,
		...(thread.threadId ? { threadId: thread.threadId } : {}),
		...(thread.runId ? { runId: thread.runId } : {}),
	};
}

/** Changes the last message, when it is the agent's. */
function withLastAgent(
	thread: ChatThread,
	change: (message: AgentMessage) => AgentMessage,
): ChatThread {
	const last = thread.messages.at(-1);
	if (last?.role !== "agent") return thread;
	return {
		...thread,
		messages: [...thread.messages.slice(0, -1), change(last)],
	};
}

/** The person sends `text`: their message, then an empty answer to fill. */
export function startAnswer(
	thread: ChatThread,
	text: string,
	ids: { person: string; agent: string },
): ChatThread {
	return {
		...thread,
		messages: [
			...thread.messages,
			{ id: ids.person, role: "person", text },
			{ id: ids.agent, role: "agent", text: "" },
		],
	};
}

/**
 * One event of the answer into the thread. `activity` and `done` change
 * nothing here: the activity line is not kept. A new proposal is open, and
 * one before it that is still open stays as it is.
 */
export function applyChatEvent(
	thread: ChatThread,
	event: ChatEvent,
	baseJson: string,
): ChatThread {
	switch (event.type) {
		case "thread":
			return { ...thread, threadId: event.threadId };
		case "text":
			return withLastAgent(thread, (message) => ({
				...message,
				text: message.text + event.delta,
			}));
		case "proposal":
			return withLastAgent(thread, (message) => ({
				...message,
				proposal: { proposal: event.proposal, baseJson, status: "open" },
			}));
		case "usage":
			return withLastAgent(thread, (message) => ({
				...message,
				usage: event.usage,
			}));
		case "error":
			return withLastAgent(thread, (message) => ({
				...message,
				error: event.message,
			}));
		default:
			return thread;
	}
}

/** The answer stopped: by the person, or because the connection broke with `error`. */
export function endAnswer(
	thread: ChatThread,
	end: { stopped: true } | { error: string },
): ChatThread {
	return withLastAgent(thread, (message) =>
		"stopped" in end
			? { ...message, stopped: true }
			: { ...message, error: message.error ?? end.error },
	);
}

/** Sets the status of the proposal in message `id`. */
export function setProposalStatus(
	thread: ChatThread,
	id: string,
	status: ProposalStatus,
): ChatThread {
	return {
		...thread,
		messages: thread.messages.map((message) =>
			message.id === id && message.role === "agent" && message.proposal
				? { ...message, proposal: { ...message.proposal, status } }
				: message,
		),
	};
}

/** The agent's answer that holds an open proposal, the latest first. */
export function openProposal(
	thread: ChatThread,
): { id: string; proposal: ChatProposal } | undefined {
	for (const message of [...thread.messages].reverse()) {
		if (message.role === "agent" && message.proposal?.status === "open")
			return { id: message.id, proposal: message.proposal };
	}
	return undefined;
}

/** Where this browser keeps the chat of one flow, for a reload. */
export function threadKey(projectId: string, flowName: string): string {
	return `nightshift:flow-chat:${projectId}/${flowName}`;
}

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The kept chat, or an empty one when there is none, it does not read, or storage is off. */
export function readThread(
	store: KeyStore | undefined,
	key: string,
): ChatThread {
	try {
		const raw = store?.getItem(key);
		if (!raw) return EMPTY_THREAD;
		const parsed: unknown = JSON.parse(raw);
		if (!isThread(parsed)) return EMPTY_THREAD;
		return parsed;
	} catch {
		return EMPTY_THREAD;
	}
}

/** Keeps the chat; an empty chat removes the key. Storage that fails is ignored. */
export function writeThread(
	store: KeyStore | undefined,
	key: string,
	thread: ChatThread,
): void {
	try {
		if (thread.messages.length === 0 && !thread.threadId && !thread.runId)
			store?.removeItem(key);
		else store?.setItem(key, JSON.stringify(thread));
	} catch {
		// Full or blocked storage: the chat lives on in this tab only.
	}
}

function isThread(value: unknown): value is ChatThread {
	if (typeof value !== "object" || value === null) return false;
	const { threadId, runId, messages } = value as Record<string, unknown>;
	if (threadId !== undefined && typeof threadId !== "string") return false;
	if (runId !== undefined && typeof runId !== "string") return false;
	return (
		Array.isArray(messages) &&
		messages.every(
			(message) =>
				typeof message === "object" &&
				message !== null &&
				typeof message.id === "string" &&
				(message.role === "person" || message.role === "agent") &&
				typeof message.text === "string",
		)
	);
}
