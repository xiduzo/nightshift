import type { Flow } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Bubble, BubbleContent } from "@nightshift/ui/components/bubble";
import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupText,
	InputGroupTextarea,
} from "@nightshift/ui/components/input-group";
import {
	Message,
	MessageContent,
	MessageFooter,
} from "@nightshift/ui/components/message";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@nightshift/ui/components/message-scroller";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import {
	ArrowUpIcon,
	CircleAlertIcon,
	SparklesIcon,
	SquareIcon,
	SquarePenIcon,
	XIcon,
} from "lucide-react";
import { type FormEvent, type KeyboardEvent, useMemo, useState } from "react";
import { formatCost } from "@/shared/format";
import { Markdown } from "@/shared/markdown";
import { PanelHeader } from "@/shared/panel";
import type { AgentMessage, ChatProposal, ChatThread } from "./chat-thread";
import { proposalCanvas } from "./proposal-canvas";
import { ProposalCard } from "./proposal-card";
import { STARTERS } from "./starters";

type Props = {
	thread: ChatThread;
	streaming: boolean;
	/** What the agent does now, while it answers. */
	activity: string | null;
	/** The editor's draft: the base of each message and of each proposal's diff. */
	draft: Flow;
	/** Why the person cannot send now, or null when they can. */
	sendBlockedBy: string | null;
	/** The flow has nothing in it yet: the chat offers ideas to start with. */
	blank: boolean;
	/** The message whose proposal the canvas shows. */
	shownId: string | null;
	onSend: (text: string) => void;
	onStop: () => void;
	onNewChat: () => void;
	onClose: () => void;
	onToggleShown: (messageId: string) => void;
	onApply: (messageId: string, proposal: ChatProposal) => void;
	onDiscard: (messageId: string) => void;
	className?: string;
};

/**
 * The chat about a flow, beside the canvas: the person asks, the agent
 * answers in Markdown and may propose a new version of the flow. The
 * proposal shows on the canvas first. Apply changes the draft only: the
 * person saves the flow.
 */
export function FlowChatPanel(props: Props) {
	const { thread, streaming, onClose, onNewChat, className } = props;
	const empty = thread.messages.length === 0;
	return (
		<aside
			aria-label="Build with an agent"
			className={cn("flex max-h-full min-h-0 flex-col", className)}
		>
			<Card className="flex h-full min-h-0 flex-col gap-0 py-0 shadow-lg">
				<PanelHeader
					icon={SparklesIcon}
					kicker="Agent"
					title="Build with an agent"
					mono={false}
					className="shrink-0 border-b p-3"
					actions={
						<>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="New chat"
								title="New chat"
								disabled={empty && !streaming}
								onClick={onNewChat}
							>
								<SquarePenIcon />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Close"
								title="Close"
								onClick={onClose}
							>
								<XIcon />
							</Button>
						</>
					}
				/>
				{empty ? <ChatEmpty {...props} /> : <ChatMessages {...props} />}
				<Composer {...props} />
			</Card>
		</aside>
	);
}

function ChatEmpty({ blank, sendBlockedBy, onSend }: Props) {
	return (
		<Empty className="min-h-0 flex-1 overflow-y-auto border-0">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<SparklesIcon />
				</EmptyMedia>
				<EmptyTitle>
					{blank
						? "Build this flow with an agent"
						: "Change this flow with an agent"}
				</EmptyTitle>
				<EmptyDescription>
					{blank
						? "Say what the flow must do. The agent reads the project and proposes the steps."
						: "Say what to change. The agent proposes it, and you see it on the canvas first."}
				</EmptyDescription>
			</EmptyHeader>
			{blank ? (
				<EmptyContent className="gap-2">
					{STARTERS.map((starter) => (
						<Button
							key={starter}
							variant="outline"
							size="sm"
							className="w-full justify-start"
							disabled={sendBlockedBy !== null}
							onClick={() => onSend(starter)}
						>
							{starter}
						</Button>
					))}
				</EmptyContent>
			) : null}
		</Empty>
	);
}

function ChatMessages(props: Props) {
	const { thread, streaming, activity } = props;
	const last = thread.messages.at(-1);
	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller className="min-h-0 flex-1">
				<MessageScrollerViewport aria-label="Chat with the agent">
					<MessageScrollerContent className="gap-4 p-3">
						{thread.messages.map((message) => (
							<MessageScrollerItem key={message.id} messageId={message.id}>
								{message.role === "person" ? (
									<Message align="end">
										<MessageContent>
											<Bubble
												variant="muted"
												align="end"
												className="max-w-[92%]"
											>
												<BubbleContent>
													<p className="whitespace-pre-wrap break-words">
														{message.text}
													</p>
												</BubbleContent>
											</Bubble>
										</MessageContent>
									</Message>
								) : (
									<AgentAnswer
										{...props}
										message={message}
										answering={streaming && message === last}
										activity={activity}
									/>
								)}
							</MessageScrollerItem>
						))}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

function AgentAnswer({
	message,
	answering,
	activity,
	draft,
	shownId,
	onToggleShown,
	onApply,
	onDiscard,
}: Props & { message: AgentMessage; answering: boolean }) {
	const cost = message.usage?.costUsd;
	return (
		<Message>
			<MessageContent>
				{message.text ? <Markdown text={message.text} /> : null}
				{answering ? (
					<p
						aria-live="polite"
						className="flex items-center gap-2 text-muted-foreground text-xs"
					>
						<Spinner />
						{activity ?? "The agent is working…"}
					</p>
				) : null}
				{message.proposal ? (
					<ProposalMessage
						proposal={message.proposal}
						draft={draft}
						shown={shownId === message.id}
						onToggleShown={() => onToggleShown(message.id)}
						onApply={() =>
							message.proposal && onApply(message.id, message.proposal)
						}
						onDiscard={() => onDiscard(message.id)}
					/>
				) : null}
				{message.error ? (
					<Alert variant="destructive">
						<CircleAlertIcon aria-hidden="true" />
						<AlertTitle>The agent could not answer</AlertTitle>
						<AlertDescription>{message.error}</AlertDescription>
					</Alert>
				) : null}
				{message.stopped ? (
					<p className="text-muted-foreground text-xs">
						You stopped the answer.
					</p>
				) : null}
				{cost !== undefined && !answering ? (
					<MessageFooter className="px-0 font-normal">
						<span title="What this answer cost">{formatCost(cost)}</span>
					</MessageFooter>
				) : null}
			</MessageContent>
		</Message>
	);
}

function ProposalMessage({
	proposal,
	draft,
	shown,
	onToggleShown,
	onApply,
	onDiscard,
}: {
	proposal: ChatProposal;
	draft: Flow;
	shown: boolean;
	onToggleShown: () => void;
	onApply: () => void;
	onDiscard: () => void;
}) {
	const canvas = useMemo(
		() => proposalCanvas(draft, proposal.proposal.flow),
		[draft, proposal.proposal.flow],
	);
	const draftJson = useMemo(() => JSON.stringify(draft), [draft]);
	return (
		<ProposalCard
			proposal={proposal}
			canvas={canvas}
			shown={shown}
			stale={draftJson !== proposal.baseJson}
			onToggleShown={onToggleShown}
			onApply={onApply}
			onDiscard={onDiscard}
		/>
	);
}

function Composer({ streaming, sendBlockedBy, onSend, onStop }: Props) {
	const [text, setText] = useState("");
	const canSend = !streaming && sendBlockedBy === null && text.trim() !== "";
	const submit = (event?: FormEvent) => {
		event?.preventDefault();
		if (!canSend) return;
		onSend(text);
		setText("");
	};
	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		// Enter sends, Shift+Enter starts a new line. Not while an IME composes.
		if (
			event.key !== "Enter" ||
			event.shiftKey ||
			event.nativeEvent.isComposing
		)
			return;
		event.preventDefault();
		submit();
	};
	return (
		<form onSubmit={submit} className="shrink-0 border-t p-3">
			<InputGroup>
				<InputGroupTextarea
					aria-label="Message to the agent"
					placeholder="Example: Run the tests after the build, and ask me before you open a pull request."
					className="max-h-40 min-h-16"
					value={text}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={onKeyDown}
				/>
				<InputGroupAddon align="block-end">
					<InputGroupText className="min-w-0 truncate text-xs">
						{sendBlockedBy ?? "Shift + Enter for a new line"}
					</InputGroupText>
					{streaming ? (
						<InputGroupButton
							variant="outline"
							size="icon-xs"
							className="ml-auto"
							aria-label="Stop"
							title="Stop the answer"
							onClick={onStop}
						>
							<SquareIcon />
						</InputGroupButton>
					) : (
						<InputGroupButton
							type="submit"
							variant="default"
							size="icon-xs"
							className="ml-auto"
							aria-label="Send"
							title="Send (Enter)"
							disabled={!canSend}
						>
							<ArrowUpIcon />
						</InputGroupButton>
					)}
				</InputGroupAddon>
			</InputGroup>
		</form>
	);
}
