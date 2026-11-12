import {
	type AnsweredGate,
	formatDay,
	gateParts,
	gateRun,
	type StatusKey,
	statusOf,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Separator } from "@nightshift/ui/components/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
} from "@nightshift/ui/components/sheet";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	ChevronRightIcon,
	CircleSlashIcon,
	HistoryIcon,
	InboxIcon,
	QuoteIcon,
	TimerIcon,
	UserIcon,
} from "lucide-react";
import { outcomeLabel, outcomeStyle } from "@/features/flows";
import { formatRelative, formatTime } from "@/shared/format";
import { InlineMarkdown, Markdown } from "@/shared/markdown";
import { LocalTime } from "@/shared/time";
import { URGENCY_LABEL, UrgencyMarker } from "@/shared/urgency";
import { ContextList } from "../gate-question";
import { GateLinks } from "./gate-links";
import { GateWhere } from "./gate-where";

const DAY_MS = 24 * 60 * 60_000;

/** One answered Gate's key: a step can wait at its Gate more than once. */
export function answeredKey(gate: AnsweredGate): string {
	return `${gate.stepId}:${gate.openedAt}`;
}

/** The look of the option a Gate took, in that option's colour. Null: nobody chose one. */
function answerLook(gate: AnsweredGate) {
	if (!gate.answer) return null;
	const choice = gate.choices.find((c) => c.name === gate.answer);
	return outcomeStyle(gate.answer, choice?.color);
}

/** Who chose: "You chose", "Night Shift chose at the deadline", "Nobody answered". */
function whoText(gate: AnsweredGate): string {
	if (gate.answeredBy === "deadline")
		return "Night Shift chose at the deadline";
	if (gate.answeredBy === "person") return "You chose";
	return "Nobody answered before the run ended";
}

/** The colour of the run's status now, beside its word. */
const RUN_DOT: Record<StatusKey, string> = {
	running: "bg-status-running",
	waiting: "bg-status-waiting",
	sleeping: "bg-status-sleeping",
	finished: "bg-status-finished",
	"nothing-to-do": "bg-status-finished",
	stopped: "bg-status-stopped",
	failed: "bg-status-failed",
	interrupted: "bg-status-interrupted",
};

function AnswerBadge({
	gate,
	className,
}: {
	gate: AnsweredGate;
	className?: string;
}) {
	const look = answerLook(gate);
	if (!look || !gate.answer) {
		return (
			<Badge
				variant="outline"
				className={cn("text-muted-foreground", className)}
			>
				<CircleSlashIcon />
				No answer
			</Badge>
		);
	}
	const Icon = look.icon;
	return (
		<Badge variant="outline" className={cn("font-mono", look.badge, className)}>
			<Icon />
			{outcomeLabel(gate.answer)}
		</Badge>
	);
}

function RunNow({ run }: { run: AnsweredGate["run"] }) {
	const { key, word } = statusOf(run);
	return (
		<span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
			<span className={cn("size-1.5 shrink-0 rounded-full", RUN_DOT[key])} />
			{word}
		</span>
	);
}

/** "Today", "Yesterday", else the day. */
function dayLabel(at: number, now: number): string {
	const day = formatDay(at);
	if (day === formatDay(now)) return "Today";
	if (day === formatDay(now - DAY_MS)) return "Yesterday";
	return day;
}

/**
 * The Gates that closed in the last 90 days, newest first, by day. Each
 * row shows the option it took in that option's colour, who chose it,
 * whether a note came with it, and the run's status now. A row opens the
 * whole Gate in a Sheet.
 */
export function AnsweredList({
	gates,
	now,
	openKey,
	onOpen,
}: {
	gates: readonly AnsweredGate[];
	now: number;
	/** The Gate the Sheet shows (`answeredKey`). */
	openKey: string | undefined;
	onOpen: (key: string | undefined) => void;
}) {
	const open = gates.find((gate) => answeredKey(gate) === openKey);
	const days: { label: string; gates: AnsweredGate[] }[] = [];
	for (const gate of gates) {
		const label = dayLabel(gate.closedAt, now);
		const last = days.at(-1);
		if (last?.label === label) last.gates.push(gate);
		else days.push({ label, gates: [gate] });
	}

	if (gates.length === 0) {
		return (
			<Empty className="h-full">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<InboxIcon />
					</EmptyMedia>
					<EmptyTitle>Nothing answered yet</EmptyTitle>
					<EmptyDescription>
						The Gates you answer show here for 90 days, with what the run did
						next.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-8">
			{days.map(({ label, gates: list }) => (
				<section key={label} className="flex flex-col gap-2">
					<h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
						{label}
					</h2>
					<ItemGroup className="gap-1.5">
						{list.map((gate) => {
							const look = answerLook(gate);
							const Icon = look?.icon ?? CircleSlashIcon;
							return (
								<Item
									key={answeredKey(gate)}
									size="sm"
									variant="outline"
									render={<button type="button" className="text-left" />}
									onClick={() => onOpen(answeredKey(gate))}
								>
									<ItemMedia
										variant="icon"
										className={cn(
											"self-start",
											look?.badge ?? "text-muted-foreground",
										)}
									>
										<Icon />
									</ItemMedia>
									<ItemContent className="min-w-0 gap-1">
										<ItemTitle className="w-full">
											<span className="truncate">
												<InlineMarkdown
													text={gateParts(gate.question).headline}
													links={false}
												/>
											</span>
										</ItemTitle>
										<ItemDescription className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
											<AnswerBadge gate={gate} />
											{gate.answeredBy === "deadline" ? (
												<span>at the deadline</span>
											) : null}
											<LocalTime at={gate.closedAt} className="tabular-nums">
												{formatTime(gate.closedAt)}
											</LocalTime>
											{gate.note ? (
												<QuoteIcon
													className="size-3"
													aria-label="With a note"
												/>
											) : null}
											<span aria-hidden="true">·</span>
											<span className="truncate font-mono">
												{gateRun(gate).flow}
											</span>
										</ItemDescription>
									</ItemContent>
									<ItemActions className="flex-col items-end gap-1 self-start">
										<RunNow run={gate.run} />
										<ChevronRightIcon
											className="size-3.5 text-muted-foreground"
											aria-hidden
										/>
									</ItemActions>
								</Item>
							);
						})}
					</ItemGroup>
				</section>
			))}
			<p className="text-muted-foreground text-xs">
				Answered Gates stay here for 90 days.
			</p>

			<Sheet
				open={open !== undefined}
				onOpenChange={(next) => {
					if (!next) onOpen(undefined);
				}}
			>
				<SheetContent className="w-full gap-0 sm:max-w-xl">
					{open ? <AnsweredSheet gate={open} now={now} /> : null}
				</SheetContent>
			</Sheet>
		</div>
	);
}

/**
 * One answered Gate in the Sheet: the result first (the option, who chose
 * it, the note), then the run's status now, then the options it offered
 * with the one it took, then what it asked, as it asked it.
 */
function AnsweredSheet({ gate, now }: { gate: AnsweredGate; now: number }) {
	const { headline, context, links } = gateParts(gate.question);
	const look = answerLook(gate);
	const recommended = gate.brief.recommendation?.option ?? null;
	const runStatus = statusOf(gate.run);
	const waited = Math.max(
		1,
		Math.round((gate.closedAt - gate.openedAt) / 60_000),
	);

	return (
		<>
			<SheetHeader className="gap-2">
				<SheetDescription
					render={<div />}
					className="flex flex-col gap-1.5 text-xs"
				>
					<GateWhere gate={gate} />
					<span className="flex items-center gap-1.5">
						<UrgencyMarker urgency={gate.urgency} quiet />
						{URGENCY_LABEL[gate.urgency]}
					</span>
				</SheetDescription>
				<SheetTitle className="whitespace-pre-wrap text-balance break-words text-xl leading-snug">
					<InlineMarkdown text={headline} />
				</SheetTitle>
			</SheetHeader>
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-6 px-4 pb-6">
					<section
						aria-label="The answer"
						className={cn(
							"flex flex-col gap-3 rounded-xl border p-4",
							look?.badge ?? "bg-muted/40",
						)}
					>
						<div className="flex flex-wrap items-center gap-2">
							<span className="flex items-center gap-1 text-foreground text-sm">
								{gate.answeredBy === "deadline" ? (
									<TimerIcon className="size-3.5" aria-hidden />
								) : gate.answeredBy === "person" ? (
									<UserIcon className="size-3.5" aria-hidden />
								) : null}
								{whoText(gate)}
							</span>
							{gate.answer ? (
								<AnswerBadge gate={gate} className="h-6 px-2 text-sm" />
							) : null}
							<LocalTime
								at={gate.closedAt}
								className="ml-auto text-muted-foreground text-xs"
							>
								{formatRelative(gate.closedAt, now)}
							</LocalTime>
						</div>
						{gate.note ? (
							<blockquote className="whitespace-pre-wrap border-current/30 border-l-2 pl-3 text-foreground text-sm">
								{gate.note}
							</blockquote>
						) : null}
						<p className="text-muted-foreground text-xs">
							It waited{" "}
							{waited < 60 ? `${waited} min` : `${Math.round(waited / 60)} h`}{" "}
							for an answer.
						</p>
					</section>

					<section className="flex flex-col gap-2">
						<h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
							The run now
						</h3>
						<Item variant="outline" size="sm">
							<ItemMedia>
								<span
									className={cn(
										"size-2.5 rounded-full",
										RUN_DOT[runStatus.key],
									)}
								/>
							</ItemMedia>
							<ItemContent className="min-w-0">
								<ItemTitle>{runStatus.word}</ItemTitle>
								<ItemDescription className="truncate">
									{gate.runTitle}
								</ItemDescription>
							</ItemContent>
						</Item>
					</section>

					{gate.choices.length > 0 ? (
						<section className="flex flex-col gap-2">
							<h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
								The options
							</h3>
							<ul className="flex flex-col gap-1.5">
								{gate.choices.map((choice) => {
									const style = outcomeStyle(choice.name, choice.color);
									const Icon = style.icon;
									const taken = choice.name === gate.answer;
									return (
										<li
											key={choice.name}
											className={cn(
												"flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
												taken ? style.badge : "opacity-60",
											)}
										>
											<Icon
												className={cn("mt-0.5 size-4 shrink-0", style.text)}
												aria-hidden
											/>
											<div className="flex min-w-0 flex-1 flex-col">
												<span className="flex flex-wrap items-center gap-2 font-mono text-foreground">
													{outcomeLabel(choice.name)}
													{taken ? (
														<span className="sr-only">(taken)</span>
													) : null}
													{choice.name === recommended ? (
														<Badge variant="secondary" className="font-sans">
															Recommended
														</Badge>
													) : null}
												</span>
												{(choice.impact ?? choice.description) ? (
													<span className="text-muted-foreground text-xs">
														{choice.impact ?? choice.description}
													</span>
												) : null}
											</div>
										</li>
									);
								})}
							</ul>
						</section>
					) : null}

					<Separator />

					<section className="flex flex-col gap-3">
						<h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
							What it asked
						</h3>
						{gate.brief.situation ? (
							<Markdown text={gate.brief.situation} />
						) : null}
						{context.length > 0 ? (
							<ContextList items={context} plain />
						) : gate.brief.situation ? null : (
							<p className="text-muted-foreground text-sm">
								The Gate asked only its question.
							</p>
						)}
						{links.length > 0 ? <GateLinks links={links} /> : null}
					</section>
				</div>
			</ScrollArea>
			<SheetFooter>
				<Button
					variant="outline"
					nativeButton={false}
					render={<Link to="/runs/$runId" params={{ runId: gate.runId }} />}
				>
					<HistoryIcon data-icon="inline-start" />
					Open the run
				</Button>
			</SheetFooter>
		</>
	);
}
