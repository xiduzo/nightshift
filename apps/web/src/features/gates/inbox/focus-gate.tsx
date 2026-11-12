import {
	type AnswerDraft,
	briefView,
	deadlineWhen,
	gateParts,
	URGENCY_LABEL,
	waitedText,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@nightshift/ui/components/collapsible";
import { Progress } from "@nightshift/ui/components/progress";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	AlarmClockIcon,
	CheckIcon,
	ChevronDownIcon,
	HistoryIcon,
	ThumbsUpIcon,
} from "lucide-react";
import { outcomeLabel } from "@/features/flows";
import { usePushUrgencies } from "@/features/notifications";
import type { OpenGate } from "@/shared/api";
import { InlineMarkdown, Markdown } from "@/shared/markdown";
import { LocalTime } from "@/shared/time";
import { UrgencyMarker } from "@/shared/urgency";
import { AskAttachments } from "../ask-attachments";
import { ContextList } from "../gate-question";
import { WrittenByModel } from "../written-by-model";
import { FocusAnswer } from "./focus-answer";
import { GateLinks } from "./gate-links";
import { GateFrom } from "./gate-where";
import { reachText } from "./ladder";

const BAND: Record<OpenGate["urgency"], string> = {
	now: "border-status-failed/40 bg-status-failed/10",
	today: "border-status-waiting/40 bg-status-waiting/10",
	later: "bg-muted/50",
};

/** Who set a Gate's urgency, in words. */
function urgencyWho(gate: OpenGate): string {
	switch (gate.brief.urgencyBy) {
		case "flow":
			return "The flow sets this level.";
		case "model":
			return "Night Shift set this level from what the run found.";
		default:
			return "Nobody set a level, so it is Today.";
	}
}

/**
 * One open Gate in focus. First how soon it needs you: its level, its
 * deadline and what Night Shift picks then, and how that level reaches
 * you. Then the question, why you decide, the links to check, and what
 * Night Shift recommends. Then your answer. What is done and the
 * question's details fold away below, unless they are all there is.
 */
export function FocusGate({
	gate,
	now,
	draft,
	onDraft,
}: {
	gate: OpenGate;
	now: number;
	draft: AnswerDraft;
	onDraft: (next: AnswerDraft) => void;
}) {
	const { headline, context, links } = gateParts(gate.question);
	const { situation, background, recommendation } = briefView(gate);
	// Without a brief the details are all there is to read: they stay open.
	const detailsOpen = situation === null;
	const attachments = gate.form?.attachments;
	const folded =
		background !== null ||
		(!detailsOpen && (context.length > 0 || Boolean(attachments)));

	return (
		<article className="flex flex-col gap-6">
			<UrgencyBand
				gate={gate}
				now={now}
				byModel={gate.brief.byModel.includes("urgency")}
			/>

			<header className="flex flex-col gap-2">
				<GateFrom gate={gate} />
				<h1 className="whitespace-pre-wrap text-balance break-words font-semibold text-2xl leading-tight tracking-tight md:text-3xl">
					<InlineMarkdown text={headline} />
				</h1>
				{situation ? (
					<div className="text-lg text-muted-foreground">
						<Markdown text={situation.text} />
						{situation.byModel ? <WrittenByModel /> : null}
					</div>
				) : null}
			</header>

			{links.length > 0 ? <GateLinks links={links} /> : null}

			{recommendation?.reason ? (
				<p className="flex items-start gap-2 text-sm">
					<ThumbsUpIcon
						className="mt-0.5 size-4 shrink-0 text-muted-foreground"
						aria-hidden
					/>
					<span>
						<span className="font-medium">
							Night Shift recommends{" "}
							{recommendation.option
								? outcomeLabel(recommendation.option)
								: "this"}
							.
						</span>{" "}
						<InlineMarkdown text={recommendation.reason} />{" "}
						{recommendation.byModel ? <WrittenByModel /> : null}
					</span>
				</p>
			) : null}

			{detailsOpen && (context.length > 0 || attachments) ? (
				<div className="flex flex-col gap-4">
					{context.length > 0 ? <ContextList items={context} plain /> : null}
					{attachments ? (
						<AskAttachments
							runId={gate.runId}
							attachments={attachments}
							filesHere={gate.walker.thisDevice}
						/>
					) : null}
				</div>
			) : null}

			<FocusAnswer gate={gate} draft={draft} onDraft={onDraft} />

			<div className="flex flex-col gap-3 border-t pt-4">
				<div className="flex flex-wrap items-center gap-2">
					{folded ? (
						<Collapsible className="flex w-full flex-col gap-3">
							<div className="flex items-center justify-between gap-2">
								<CollapsibleTrigger
									render={
										<Button variant="ghost" size="sm" className="-ml-2.5" />
									}
								>
									More about this
									<ChevronDownIcon data-icon="inline-end" />
								</CollapsibleTrigger>
								<OpenRun runId={gate.runId} />
							</div>
							<CollapsibleContent className="flex flex-col gap-4">
								{background ? (
									<section className="flex flex-col gap-1.5">
										<h3 className="flex items-baseline gap-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
											What is done
											{background.byModel ? <WrittenByModel /> : null}
										</h3>
										<ul className="flex flex-col gap-1.5 text-sm">
											{background.items.map((item, index) => (
												<li key={index} className="flex gap-2">
													<CheckIcon
														className="mt-0.5 size-4 shrink-0 text-muted-foreground"
														aria-hidden
													/>
													<span className="min-w-0 flex-1">
														<InlineMarkdown text={item.text} />
													</span>
													{item.source ? (
														<Badge
															variant="secondary"
															className="max-w-40 truncate"
														>
															{item.source}
														</Badge>
													) : null}
												</li>
											))}
										</ul>
									</section>
								) : null}
								{!detailsOpen && context.length > 0 ? (
									<ContextList items={context} plain />
								) : null}
								{!detailsOpen && attachments ? (
									<AskAttachments
										runId={gate.runId}
										attachments={attachments}
										filesHere={gate.walker.thisDevice}
									/>
								) : null}
							</CollapsibleContent>
						</Collapsible>
					) : (
						<OpenRun runId={gate.runId} className="ml-auto" />
					)}
				</div>
			</div>
		</article>
	);
}

function OpenRun({ runId, className }: { runId: string; className?: string }) {
	return (
		<Button
			variant="ghost"
			size="sm"
			className={className}
			nativeButton={false}
			render={<Link to="/runs/$runId" params={{ runId }} />}
		>
			<HistoryIcon data-icon="inline-start" />
			Open the run
		</Button>
	);
}

/**
 * How soon a Gate needs you: its level, its deadline (with what Night
 * Shift picks then and a bar of the time used) or how long it waits, and
 * who set the level and how it reaches you.
 */
function UrgencyBand({
	gate,
	now,
	byModel,
}: {
	gate: OpenGate;
	now: number;
	byModel: boolean;
}) {
	const pushUrgencies = usePushUrgencies();
	const reach = reachText(gate.urgency, pushUrgencies);
	const { deadline } = gate;
	const used = deadline
		? Math.min(
				100,
				Math.max(
					0,
					((now - gate.openedAt) / Math.max(1, deadline.at - gate.openedAt)) *
						100,
				),
			)
		: null;

	return (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-xl border p-3",
				BAND[gate.urgency],
			)}
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
				<span className="inline-flex items-center gap-1.5 font-medium">
					<UrgencyMarker urgency={gate.urgency} />
					{URGENCY_LABEL[gate.urgency]}
				</span>
				{deadline ? (
					<DeadlineText deadline={deadline} now={now} />
				) : (
					<LocalTime
						at={gate.openedAt}
						className="text-muted-foreground text-xs tabular-nums"
					>
						Waits {waitedText(now - gate.openedAt)}
					</LocalTime>
				)}
			</div>
			{used !== null ? <Progress value={used} className="h-1" /> : null}
			<p className="flex flex-wrap items-baseline gap-x-1 text-muted-foreground text-xs">
				{urgencyWho(gate)}
				{reach ? ` ${reach}` : null}
				{byModel ? <WrittenByModel /> : null}
			</p>
		</div>
	);
}

/** "Due 12:00 (in 18 min). Then Night Shift picks roll back." */
function DeadlineText({
	deadline,
	now,
}: {
	deadline: NonNullable<OpenGate["deadline"]>;
	now: number;
}) {
	const { time, day } = deadlineWhen(deadline.at, now);
	return (
		<span className="inline-flex flex-wrap items-center gap-1 text-status-waiting text-xs">
			<AlarmClockIcon className="size-3.5" aria-hidden />
			<LocalTime at={deadline.at} className="font-medium tabular-nums">
				Due {time}
				{day}
			</LocalTime>
			<span className="tabular-nums">({untilText(deadline.at - now)}).</span>
			<span>
				Then Night Shift picks{" "}
				<span className="font-medium font-mono">
					{outcomeLabel(deadline.choose)}
				</span>
				.
			</span>
		</span>
	);
}

/** "in 18 min", "in 2 h 10 min", "now". */
function untilText(ms: number): string {
	if (ms <= 60_000) return "now";
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.round((ms % 3_600_000) / 60_000);
	if (hours === 0) return `in ${minutes} min`;
	return minutes === 0 ? `in ${hours} h` : `in ${hours} h ${minutes} min`;
}
