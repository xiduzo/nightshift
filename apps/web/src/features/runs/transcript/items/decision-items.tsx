/** The items of a Decision or Value step: the question to a model, the rule, the Gate, the result. */
import { parseGateQuestion, plainText } from "@nightshift/client";
import type { JsonValue } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceDescription,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@nightshift/ui/components/trace";
import { cn } from "@nightshift/ui/lib/utils";
import { AlarmClockIcon, BracesIcon, HandIcon, SplitIcon } from "lucide-react";
import { outcomeLabel, outcomeStyle, stepStateStyle } from "@/features/flows";
import { GateQuestion as GateQuestionText } from "@/features/gates";
import { JsonBlock } from "@/shared/code";
import { formatDateTime, formatTime } from "@/shared/format";
import type {
	DecisionAskItem,
	DecisionItem,
	GateOpenItem,
	GateResolvedItem,
	RuleItem,
	ValueAskItem,
	ValueItem,
} from "../transcript-items";
import { Divider, PromptBubble, ResultCard } from "./parts";

/** What the model was asked, with the options it could pick. */
export function DecisionAsk({ item }: { item: DecisionAskItem }) {
	return (
		<div className="flex flex-col gap-3">
			<Divider
				title="Decision"
				at={item.at}
				details={[formatTime(item.at), item.model]}
			/>
			<PromptBubble label="Prompt" prompt={item.prompt} empty="No prompt.">
				<p className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
					Picks one of
					{item.labels.map((label) => (
						<Badge
							key={label}
							variant="outline"
							className={cn("font-mono", outcomeStyle(label).badge)}
						>
							{outcomeLabel(label)}
						</Badge>
					))}
				</p>
			</PromptBubble>
		</div>
	);
}

/** The option the model picked, and its notes on why. */
export function DecisionCard({ item }: { item: DecisionItem }) {
	const { text } = outcomeStyle(item.label);
	return (
		<ResultCard
			icon={SplitIcon}
			kicker="Decided ·"
			value={<span className="font-mono">{outcomeLabel(item.label)}</span>}
			tone={text}
		>
			{item.notes.trim() ? (
				<p className="whitespace-pre-wrap break-words leading-relaxed">
					{item.notes}
				</p>
			) : (
				<p className="text-muted-foreground italic">No notes.</p>
			)}
		</ResultCard>
	);
}

/** Which option the rule picked, and what each rule gave on the way there. */
export function RuleCard({ item }: { item: RuleItem }) {
	const matched = item.matched;
	const { text } = matched ? outcomeStyle(matched) : { text: "" };
	return (
		<ResultCard
			icon={SplitIcon}
			kicker={matched ? "Rule picked ·" : undefined}
			value={
				matched ? (
					<span className="font-mono">{outcomeLabel(matched)}</span>
				) : (
					"No option matched"
				)
			}
			tone={matched ? text : "text-destructive"}
		>
			<ul className="flex flex-col gap-1 text-xs">
				{item.evaluated.map((entry) => (
					<li key={entry.option} className="flex items-center gap-2">
						<Badge
							variant="outline"
							className={cn("font-mono", outcomeStyle(entry.option).badge)}
						>
							{outcomeLabel(entry.option)}
						</Badge>
						<span className="text-muted-foreground">
							{entry.result === null
								? entry.option === matched
									? "no rule: the default"
									: "no value"
								: ruleResultText(entry.result)}
						</span>
					</li>
				))}
			</ul>
		</ResultCard>
	);
}

/** What a Value step was asked: the expression a rule evaluates, or the prompt a model reads. */
export function ValueAsk({ item }: { item: ValueAskItem }) {
	const rule = item.by === "rule";
	return (
		<div className="flex flex-col gap-3">
			<Divider
				title="Value"
				at={item.at}
				details={[formatTime(item.at), rule ? "a rule" : item.model]}
			/>
			<PromptBubble
				label={rule ? "Expression" : "Prompt"}
				prompt={item.source}
				empty={rule ? "No expression." : "No prompt."}
			/>
		</div>
	);
}

/** The value made, as data, or why there is none. */
export function ValueCard({ item }: { item: ValueItem }) {
	const made = item.problem === null;
	const { label, text } = stepStateStyle(made ? "pass" : "fail");
	return (
		<ResultCard
			icon={BracesIcon}
			kicker={made ? "Value made ·" : "No value ·"}
			value={label}
			tone={text}
		>
			{made ? (
				<JsonBlock value={item.data} />
			) : (
				<p className="whitespace-pre-wrap break-words leading-relaxed">
					{item.problem}
				</p>
			)}
		</ResultCard>
	);
}

/** A rule's value in words: held or did not hold for a boolean, else the value. */
function ruleResultText(result: JsonValue): string {
	if (result === true) return "held";
	if (result === false) return "did not hold";
	return typeof result === "string" ? result : JSON.stringify(result);
}

/**
 * The question of a Gate that is no longer open, as a quiet line: what it
 * asked. It opens on the whole question and its choices. An open Gate is
 * a GateConfirmation (from the gates vertical) in its place.
 */
export function GateQuestion({ item }: { item: GateOpenItem }) {
	const { headline } = parseGateQuestion(item.question);
	return (
		<Trace>
			<TraceCollapsible>
				<TraceCollapsibleTrigger>
					<TraceLine className="text-xs">
						<TraceIcon>
							<HandIcon className="size-3.5" />
						</TraceIcon>
						<TraceTitle>Asked: {plainText(headline)}</TraceTitle>
						<TraceDescription>
							<time
								dateTime={new Date(item.at).toISOString()}
								title={formatDateTime(item.at)}
							>
								{formatTime(item.at)}
							</time>
						</TraceDescription>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent className="flex flex-col gap-3 text-xs">
					<GateQuestionText question={item.question} />
					<p className="flex flex-wrap items-center gap-1">
						Choices
						{item.choices.map((choice) => (
							<Badge
								key={choice.name}
								variant="outline"
								className={cn(
									"font-mono",
									outcomeStyle(choice.name, choice.color).badge,
								)}
							>
								{outcomeLabel(choice.name)}
							</Badge>
						))}
					</p>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}

/** The answer a person gave and their note, or the option the deadline chose, as a quiet line. */
export function GateResolved({ item }: { item: GateResolvedItem }) {
	const { text } = outcomeStyle(item.choice, item.color);
	const Icon = item.byDeadline ? AlarmClockIcon : HandIcon;
	return (
		<div className="flex flex-col gap-1">
			<Marker className="text-xs">
				<MarkerIcon>
					<Icon className={cn("size-3.5", text)} />
				</MarkerIcon>
				<MarkerContent>
					{item.byDeadline ? "Nobody answered in time. Picked " : "Answered "}
					<span className={cn("font-medium font-mono", text)}>
						{outcomeLabel(item.choice)}
					</span>{" "}
					·{" "}
					<time
						dateTime={new Date(item.at).toISOString()}
						title={formatDateTime(item.at)}
					>
						{formatTime(item.at)}
					</time>
				</MarkerContent>
			</Marker>
			{item.note.trim() ? (
				<p className="ml-6 whitespace-pre-wrap break-words border-l-2 pl-3 text-muted-foreground text-xs leading-relaxed">
					{item.note}
				</p>
			) : null}
		</div>
	);
}
