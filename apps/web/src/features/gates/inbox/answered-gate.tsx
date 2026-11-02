import { type AnsweredGate, gateParts, gateRun } from "@nightshift/client";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Separator } from "@nightshift/ui/components/separator";
import { Link } from "@tanstack/react-router";
import {
	CheckIcon,
	ChevronRightIcon,
	CircleSlashIcon,
	HistoryIcon,
	TimerIcon,
} from "lucide-react";
import { formatRelative } from "@/shared/format";
import { InlineMarkdown } from "@/shared/markdown";
import { LocalTime } from "@/shared/time";
import { ContextList } from "../gate-question";
import { GateWhere } from "./gate-where";

/** The icon of how a Gate closed: you chose, the deadline chose, or the run ended first. */
function ClosedIcon({ gate }: { gate: AnsweredGate }) {
	if (gate.answeredBy === "deadline") return <TimerIcon />;
	if (gate.answeredBy === "person") return <CheckIcon />;
	return <CircleSlashIcon />;
}

/** "Approve", "Approve at the deadline", "No answer". */
function answerText(gate: AnsweredGate): string {
	if (!gate.answer) return "No answer";
	return gate.answeredBy === "deadline"
		? `${gate.answer} at the deadline`
		: gate.answer;
}

/** One answered Gate in the list: dimmed, with the option it took and when. */
export function AnsweredGateNavItem({
	gate,
	now,
	selected,
	onClick,
}: {
	gate: AnsweredGate;
	now: number;
	selected: boolean;
	onClick: () => void;
}) {
	const { headline } = gateParts(gate.question);
	const { flow } = gateRun(gate);
	return (
		<Item
			size="xs"
			variant={selected ? "muted" : "default"}
			render={
				<button
					type="button"
					className="text-left"
					aria-current={selected ? "page" : undefined}
				/>
			}
			onClick={onClick}
		>
			<ItemMedia variant="icon" className="self-start text-muted-foreground">
				<ClosedIcon gate={gate} />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle className="w-full font-normal text-muted-foreground">
					<span className="line-clamp-2">
						<InlineMarkdown text={headline} links={false} />
					</span>
				</ItemTitle>
				<ItemDescription className="truncate text-xs">
					<span className="font-medium">{flow}</span> · {answerText(gate)} ·{" "}
					{formatRelative(gate.closedAt, now)}
				</ItemDescription>
			</ItemContent>
		</Item>
	);
}

/**
 * One answered Gate in the pane, to read only: what it asked, what
 * happened, the option it took and who chose it, and its run.
 */
export function AnsweredGateDetail({ gate }: { gate: AnsweredGate }) {
	const { headline, context } = gateParts(gate.question);
	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-8 pb-16 md:px-8">
			<header className="flex items-start gap-4">
				<div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-5">
					<ClosedIcon gate={gate} />
				</div>
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<GateWhere gate={gate} />
					<h1 className="whitespace-pre-wrap text-balance break-words font-semibold text-xl leading-snug tracking-tight">
						<InlineMarkdown text={headline} />
					</h1>
					<div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
						<Badge variant="secondary">
							{gate.answeredBy === "person"
								? `You chose ${gate.answer}`
								: gate.answeredBy === "deadline"
									? `Night Shift chose ${gate.answer} at the deadline`
									: "The run ended before an answer"}
						</Badge>
						<LocalTime at={gate.closedAt}>
							{formatRelative(gate.closedAt)}
						</LocalTime>
					</div>
				</div>
			</header>
			<Separator />
			<div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
				<section className="flex min-w-0 flex-col gap-3">
					<h2 className="font-medium text-sm">What happened</h2>
					{context.length > 0 ? (
						<ContextList items={context} plain />
					) : (
						<p className="text-muted-foreground text-sm">
							The Gate asked only its question.
						</p>
					)}
				</section>
				<aside className="lg:sticky lg:top-8 lg:self-start">
					<Item
						variant="outline"
						size="sm"
						render={<Link to="/runs/$runId" params={{ runId: gate.runId }} />}
					>
						<ItemMedia variant="icon">
							<HistoryIcon />
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle>Open the run</ItemTitle>
							<ItemDescription className="truncate text-xs">
								See what it did after this answer
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							<ChevronRightIcon
								className="size-3.5 text-muted-foreground"
								aria-hidden="true"
							/>
						</ItemActions>
					</Item>
				</aside>
			</div>
		</div>
	);
}
