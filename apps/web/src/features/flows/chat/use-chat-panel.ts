import { type Flow, isSavable } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import {
	type ComponentProps,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { runQueries } from "@/features/runs/flows-port";
import { type FlowAssistant, replaceDraft } from "../assistant/flow-assistant";
import { type ChatLink, linkEntry } from "./chat-link";
import type { FlowChatPanel } from "./chat-panel";
import {
	chatAgent,
	restorePoint,
	startedBy,
	threadOpening,
} from "./chat-thread";
import { type ProposalCanvas, proposalCanvas } from "./proposal-canvas";
import { isBlankFlow } from "./starters";
import { useFlowChat } from "./use-flow-chat";

const SEND_BLOCKED = "Fix the fields marked in the issues first.";

/**
 * The editor's side of the chat: whether the panel is open, the proposal
 * the canvas shows, and Apply, Undo, Discard and Restore on the draft. A new, blank
 * flow opens with the panel. A `link` opens the panel too. A link of an
 * entry starts a new chat of that entry: about its run, with the first
 * message of the entry sent when it has one.
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
			const entry = linkEntry(link);
			const runId = link.kind === "run" ? link.runId : undefined;
			// The same chat after a reload: it asked already.
			const asked =
				chat.thread.entry === entry &&
				chat.thread.runId === runId &&
				chat.thread.messages.length > 0;
			if (entry && !asked) {
				chat.start(
					startedBy(entry, {
						...(runId ? { runId } : {}),
						...(link.kind === "run" && link.saving
							? { saving: link.saving }
							: {}),
					}),
					// A draft that cannot be sent waits: the person fixes it and asks.
					isSavable(assistant.flow) ? assistant.flow : undefined,
				);
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
		agent: chatAgent(chat.thread),
		opening:
			chat.thread.messages.length === 0 ? threadOpening(chat.thread) : null,
		streaming: chat.streaming,
		activity: chat.activity,
		draft,
		blank: isBlankFlow(draft),
		run: runId
			? {
					id: runId,
					status: run.data?.status,
					title: run.data?.title,
					steps: run.data?.steps,
				}
			: null,
		sendBlockedBy: isSavable(draft) ? null : SEND_BLOCKED,
		shownId: shown ? shownId : null,
		onSend: send,
		onOpen: () => {
			chat.open(draft);
			setShownId(null);
		},
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
		onRestore: (id) => {
			const point = restorePoint(chat.thread, id);
			if (!point) return;
			let before: Flow;
			try {
				before = JSON.parse(point.baseJson) as Flow;
			} catch {
				toast.error("This point of the chat cannot be restored.");
				return;
			}
			setShownId(null);
			// The proposals leave the flow: their choice is open again.
			for (const applied of point.applied) chat.markProposal(applied, "open");
			// The same path as Apply: one step of the editor's undo history.
			replaceDraft(
				assistant,
				before,
				"Flow restored. Save the flow to keep it.",
				() => {
					for (const applied of point.applied)
						chat.markProposal(applied, "applied");
				},
			);
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
