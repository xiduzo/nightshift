import type { Flow } from "@nightshift/flows";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/shared/api";
import {
	applyChatEvent,
	type ChatThread,
	chatRequest,
	EMPTY_THREAD,
	endAnswer,
	type ProposalStatus,
	readThread,
	setProposalStatus,
	startAnswer,
	threadKey,
	threadOpening,
	writeThread,
} from "./chat-thread";
import { followChat, NO_ANSWER } from "./follow-chat";

function sessionStore(): Storage | undefined {
	try {
		return window.sessionStorage;
	} catch {
		return undefined;
	}
}

/**
 * The chat about one flow: its messages, the answer that streams now and
 * the line about what the agent does. The tab keeps the chat over a
 * reload. Leaving the editor stops an answer. Each message carries the
 * entry of the chat, and its run when it is about one. Which agent answers
 * is Night Shift's choice (Settings), not a field of the message.
 */
export function useFlowChat(projectId: string, flowName: string) {
	const key = threadKey(projectId, flowName);
	const [thread, setThread] = useState<ChatThread>(() =>
		readThread(sessionStore(), key),
	);
	const [streaming, setStreaming] = useState(false);
	const [activity, setActivity] = useState<string | null>(null);
	const running = useRef<AbortController | null>(null);
	// The thread as it is now, for a message sent right after the thread changed.
	const current = useRef(thread);
	current.current = thread;

	useEffect(() => writeThread(sessionStore(), key, thread), [key, thread]);
	useEffect(() => () => running.current?.abort(), []);

	/**
	 * Sends `text` in `base`, the thread as it is or a new one. Null: the
	 * first message of the entry of `base`. The page shows its words, and
	 * the request sends none.
	 */
	const post = useCallback(
		(text: string | null, flow: Flow, base: ChatThread) => {
			const message = text === null ? threadOpening(base) : text.trim();
			if (!message || running.current) return;
			const controller = new AbortController();
			running.current = controller;
			const baseJson = JSON.stringify(flow);
			const id = crypto.randomUUID();
			const request = chatRequest(base, {
				projectId,
				flowName,
				flow,
				...(text === null ? {} : { message }),
			});
			const started = startAnswer(base, message, {
				person: `${id}:person`,
				agent: `${id}:agent`,
			});
			current.current = started;
			setThread(started);
			setStreaming(true);
			setActivity(null);
			void followChat({
				client,
				request,
				signal: controller.signal,
				onEvent: (event) => {
					if (event.type === "activity") setActivity(event.text);
					else setThread((now) => applyChatEvent(now, event, baseJson));
				},
			}).then((end) => {
				// "New chat" let go of this answer: nothing of it reaches the new chat.
				if (running.current !== controller) return;
				running.current = null;
				setStreaming(false);
				setActivity(null);
				if (end.kind === "stopped")
					setThread((now) => endAnswer(now, { stopped: true }));
				else if (end.kind === "broken")
					setThread((now) =>
						endAnswer(now, { error: end.message ?? NO_ANSWER }),
					);
			});
		},
		[projectId, flowName],
	);

	const send = useCallback(
		(text: string, flow: Flow) => post(text, flow, current.current),
		[post],
	);

	/** Lets go of the answer that streams now, if any. */
	const letGo = useCallback(() => {
		running.current?.abort();
		running.current = null;
		setStreaming(false);
		setActivity(null);
	}, []);

	/** Sends the first message of the chat's entry, when it has one. */
	const open = useCallback(
		(flow: Flow) => post(null, flow, current.current),
		[post],
	);

	/**
	 * A new chat, `thread`, as an entry starts it. With `flow`, the first
	 * message of the entry goes at once, when it has one. Without, the
	 * person sends the first message.
	 */
	const start = useCallback(
		(thread: ChatThread, flow?: Flow) => {
			letGo();
			current.current = thread;
			setThread(thread);
			if (flow) post(null, flow, thread);
		},
		[letGo, post],
	);

	const stop = useCallback(() => running.current?.abort(), []);

	const reset = useCallback(() => {
		letGo();
		current.current = EMPTY_THREAD;
		setThread(EMPTY_THREAD);
	}, [letGo]);

	const markProposal = useCallback(
		(messageId: string, status: ProposalStatus) =>
			setThread((current) => setProposalStatus(current, messageId, status)),
		[],
	);

	return {
		thread,
		streaming,
		activity,
		send,
		open,
		start,
		stop,
		reset,
		markProposal,
	};
}
