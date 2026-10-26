import { isSavable } from "@nightshift/flows";
import { type ComponentProps, useMemo, useState } from "react";
import { type FlowAssistant, replaceDraft } from "../assistant/flow-assistant";
import type { FlowChatPanel } from "./chat-panel";
import { type ProposalCanvas, proposalCanvas } from "./proposal-canvas";
import { isBlankFlow } from "./starters";
import { useFlowChat } from "./use-flow-chat";

/**
 * The editor's side of the chat: whether the panel is open, the proposal
 * the canvas shows, and Apply and Discard on the draft. A new, blank flow
 * opens with the panel.
 */
export function useChatPanel(
	assistant: FlowAssistant,
	{ openAtStart }: { openAtStart: boolean },
) {
	const { projectId, flowName, flow: draft } = assistant;
	const chat = useFlowChat(projectId, flowName);
	const [open, setOpen] = useState(
		() => openAtStart && isBlankFlow(assistant.flow),
	);
	const [shownId, setShownId] = useState<string | null>(null);

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
		sendBlockedBy: isSavable(draft)
			? null
			: "Fix the fields marked in the issues first.",
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
