import type { Flow } from "@nightshift/flows";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "@/shared/api";
import {
	applyChatEvent,
	type ChatThread,
	EMPTY_THREAD,
	endAnswer,
	type ProposalStatus,
	readThread,
	setProposalStatus,
	startAnswer,
	threadKey,
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
 * reload. Leaving the editor stops an answer.
 */
export function useFlowChat(projectId: string, flowName: string) {
	const key = threadKey(projectId, flowName);
	const [thread, setThread] = useState<ChatThread>(() =>
		readThread(sessionStore(), key),
	);
	const [streaming, setStreaming] = useState(false);
	const [activity, setActivity] = useState<string | null>(null);
	const running = useRef<AbortController | null>(null);

	useEffect(() => writeThread(sessionStore(), key, thread), [key, thread]);
	useEffect(() => () => running.current?.abort(), []);

	const send = useCallback(
		(text: string, flow: Flow) => {
			const message = text.trim();
			if (!message || running.current) return;
			const controller = new AbortController();
			running.current = controller;
			const baseJson = JSON.stringify(flow);
			const id = crypto.randomUUID();
			setThread((current) =>
				startAnswer(current, message, {
					person: `${id}:person`,
					agent: `${id}:agent`,
				}),
			);
			setStreaming(true);
			setActivity(null);
			void followChat({
				client,
				request: {
					projectId,
					flowName,
					flow,
					message,
					threadId: thread.threadId,
				},
				signal: controller.signal,
				onEvent: (event) => {
					if (event.type === "activity") setActivity(event.text);
					else setThread((current) => applyChatEvent(current, event, baseJson));
				},
			}).then((end) => {
				// "New chat" let go of this answer: nothing of it reaches the new chat.
				if (running.current !== controller) return;
				running.current = null;
				setStreaming(false);
				setActivity(null);
				if (end.kind === "stopped")
					setThread((current) => endAnswer(current, { stopped: true }));
				else if (end.kind === "broken")
					setThread((current) =>
						endAnswer(current, { error: end.message ?? NO_ANSWER }),
					);
			});
		},
		[projectId, flowName, thread.threadId],
	);

	const stop = useCallback(() => running.current?.abort(), []);

	const reset = useCallback(() => {
		running.current?.abort();
		running.current = null;
		setStreaming(false);
		setActivity(null);
		setThread(EMPTY_THREAD);
	}, []);

	const markProposal = useCallback(
		(messageId: string, status: ProposalStatus) =>
			setThread((current) => setProposalStatus(current, messageId, status)),
		[],
	);

	return { thread, streaming, activity, send, stop, reset, markProposal };
}
