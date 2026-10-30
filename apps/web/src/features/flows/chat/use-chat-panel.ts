import { isSavable } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import {
	type ComponentProps,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { runQueries } from "@/features/runs/flows-port";
import { type FlowAssistant, replaceDraft } from "../assistant/flow-assistant";
import type { ChatLink } from "./chat-link";
import type { FlowChatPanel } from "./chat-panel";
import { ASK_WHY_MESSAGE } from "./chat-thread";
import { type ProposalCanvas, proposalCanvas } from "./proposal-canvas";
import { isBlankFlow } from "./starters";
import { useFlowChat } from "./use-flow-chat";

const SEND_BLOCKED = "Fix the fields marked in the issues first.";

/**
 * The editor's side of the chat: whether the panel is open, the proposal
 * the canvas shows, and Apply, Undo and Discard on the draft. A new, blank
 * flow opens with the panel. A `link` opens the panel too: a link about a
 * run starts a chat about that run, with its first message sent.
 * `onLinkUsed` then drops the link, so a reload does not ask again.
 */
export function useChatPanel(
	assistant: FlowAssistant,
	{
		openAtStart,
		link,
		onLinkUsed,
	}: {
		openAtStart: boolean;
		link?: ChatLink;
		onLinkUsed?: () => void;
	},
) {
	const { projectId, flowName, flow: draft } = assistant;
	const chat = useFlowChat(projectId, flowName);
	const [open, setOpen] = useState(
		() => link !== undefined || (openAtStart && isBlankFlow(assistant.flow)),
	);
	const [shownId, setShownId] = useState<string | null>(null);

	// The link acts once, after the first render. A timer, not the effect
	// itself: a strict-mode remount clears it, and the message goes once.
	const start = useRef({ link, onLinkUsed, chat, assistant });
	start.current = { link, onLinkUsed, chat, assistant };
	useEffect(() => {
		const timer = setTimeout(() => {
			const { link, onLinkUsed, chat, assistant } = start.current;
			if (!link) return;
			if (
				link.kind === "run" &&
				// The same chat after a reload: it asked already.
				!(chat.thread.runId === link.runId && chat.thread.messages.length > 0)
			) {
				// A draft that cannot be sent waits: the person fixes it and asks.
				if (isSavable(assistant.flow))
					chat.startAboutRun(link.runId, ASK_WHY_MESSAGE, assistant.flow);
				else chat.startAboutRun(link.runId);
			}
			onLinkUsed?.();
		}, 0);
		return () => clearTimeout(timer);
	}, []);

	const runId = chat.thread.runId;
	const run = useQuery({
		...runQueries.get(runId ?? ""),
		enabled: runId !== undefined,
	});

	// Only an open proposal shows: Apply or Discard ends the view.
	const shown = useMemo(() => {
		if (!open || shownId === null) return null;
		const message = chat.thread.messages.find(
			(candidate) => candidate.id === shownId,
		);
		return message?.role === "agent" && message.proposal?.status === "open"
			? message.proposal
			: null;
	}, [open, shownId, chat.thread]);

	const preview: ProposalCanvas | null = useMemo(
		() => (shown ? proposalCanvas(draft, shown.proposal.flow) : null),
		[shown, draft],
	);

	const send = (text: string) => {
		chat.send(text, draft);
		setShownId(null);
	};

	const panel: ComponentProps<typeof FlowChatPanel> = {
		thread: chat.thread,
		streaming: chat.streaming,
		activity: chat.activity,
		draft,
		blank: isBlankFlow(draft),
		run: runId
			? { id: runId, status: run.data?.status, title: run.data?.title }
			: null,
		sendBlockedBy: isSavable(draft) ? null : SEND_BLOCKED,
		shownId: shown ? shownId : null,
		onSend: send,
		onStop: chat.stop,
		onNewChat: () => {
			chat.reset();
			setShownId(null);
		},
		onClose: () => setOpen(false),
		onToggleShown: (id) =>
			setShownId((current) => (current === id ? null : id)),
		onApply: (id, proposal) => {
			setShownId(null);
			chat.markProposal(id, "applied");
			replaceDraft(
				assistant,
				proposal.proposal.flow,
				"Change applied. Save the flow to keep it.",
				// Undo gives the choice back: the proposal is open again.
				() => chat.markProposal(id, "open"),
			);
		},
		onDiscard: (id) => {
			setShownId(null);
			chat.markProposal(id, "discarded");
		},
	};

	return {
		open,
		toggle: () => setOpen((current) => !current),
		preview,
		hidePreview: () => setShownId(null),
		panel,
	};
}
