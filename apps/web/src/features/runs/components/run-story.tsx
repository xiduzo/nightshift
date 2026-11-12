import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Marker, MarkerContent } from "@nightshift/ui/components/marker";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerViewport,
	useMessageScroller,
} from "@nightshift/ui/components/message-scroller";
import { ListTodoIcon } from "lucide-react";
import { Fragment, type ReactNode, useEffect } from "react";
import type { Artifact, RunDetail, RunStatus, StepSummary } from "@/shared/api";
import { formatTime } from "@/shared/format";
import { type ItemScope, nodeOfStep, stepOutcomeColor } from "../lib/run-steps";
import {
	emptyTranscript,
	type TranscriptState,
} from "../transcript/transcript";
import { StepChapter } from "./step-chapter";

/** A pick of a step: each one scrolls the story to it, also the same step again. */
export type StepPick = { stepId: string; seq: number };

/**
 * The run as one conversation, top to bottom: every step in full, each
 * starting at its checkpoint. A checkpoint marks what is new since the
 * person last looked.
 */
export function RunStory({
	run,
	steps,
	story,
	status,
	transcripts,
	artifacts,
	connecting,
	seen,
	pick,
	warnedStepIds,
	focus,
	onSelectItem,
	onShowStep,
	stepAction,
	stepContext,
	ending,
}: {
	run: RunDetail;
	/** Every step of the run. */
	steps: StepSummary[];
	/** The steps the story tells: the run's, or the call's in focus. */
	story: StepSummary[];
	status: RunStatus;
	transcripts: ReadonlyMap<string, TranscriptState>;
	artifacts: Artifact[];
	connecting: boolean;
	/** When the person last looked at this run. Null: never, here. */
	seen: number | null;
	/** A step a link, the visits or the flow picked: the story scrolls to it. */
	pick: StepPick | null;
	warnedStepIds: ReadonlySet<string>;
	focus: ItemScope;
	onSelectItem: (scope: ItemScope) => void;
	onShowStep: (stepId: string) => void;
	stepAction?: (step: StepSummary) => ReactNode;
	stepContext?: (step: StepSummary) => ReactNode;
	/** What the run does now, and what went wrong along the way. */
	ending: ReactNode;
}) {
	const { scrollToMessage } = useMessageScroller();

	useEffect(() => {
		if (!pick) return;
		const id = pick.stepId;
		// After the step renders in full, so the scroll lands on its top.
		const frame = requestAnimationFrame(() =>
			scrollToMessage(id, { align: "start", behavior: "smooth" }),
		);
		return () => cancelAnimationFrame(frame);
	}, [pick, scrollToMessage]);

	if (story.length === 0) {
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<ListTodoIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No steps yet</EmptyTitle>
					<EmptyDescription>
						{focus
							? "The steps of this call show here once they start."
							: "The first one starts in a moment."}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	// The first step that started after the person last looked.
	const firstNew =
		seen === null ? undefined : story.find((step) => step.startedAt > seen);
	const answerPending = run.commands.some((c) => c.kind === "gate.resolve");

	return (
		<MessageScroller>
			<MessageScrollerViewport aria-label="The run, step by step">
				<MessageScrollerContent className="mx-auto w-full max-w-3xl gap-6 px-4 py-6 md:px-8">
					{story.map((step, index) => {
						const props = {
							run,
							steps,
							step,
							runStatus: status,
							transcript: transcripts.get(step.id) ?? emptyTranscript,
							artifacts: artifacts.filter(
								(artifact) => artifact.stepId === step.id,
							),
							connecting,
							answerPending,
							outcomeColor: stepOutcomeColor(run, steps, step),
							node: nodeOfStep(run, steps, step),
							warned: warnedStepIds.has(step.id),
							focus,
							onSelectItem,
							onShowStep,
							context: stepContext?.(step),
							action: stepAction?.(step),
						};
						return (
							<Fragment key={step.id}>
								{step === firstNew && index > 0 && seen !== null ? (
									<Marker
										variant="separator"
										className="font-medium text-destructive text-xs before:bg-destructive/40 after:bg-destructive/40"
									>
										<MarkerContent>
											New since you looked · {formatTime(seen)}
										</MarkerContent>
									</Marker>
								) : null}
								<MessageScrollerItem messageId={step.id}>
									<StepChapter {...props} />
								</MessageScrollerItem>
							</Fragment>
						);
					})}
					<div className="flex flex-col gap-3 empty:hidden">{ending}</div>
				</MessageScrollerContent>
			</MessageScrollerViewport>
			<MessageScrollerButton />
		</MessageScroller>
	);
}
