/** The items of an agent session: its start, the messages, the step report, the end. */
import { type FlowNode, outcomeColor } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import { Message, MessageContent } from "@nightshift/ui/components/message";
import {
	CircleCheckIcon,
	CircleStopIcon,
	CircleXIcon,
	ClockIcon,
} from "lucide-react";
import { stepStateStyle } from "@/features/flows";
import { JsonBlock } from "@/shared/code";
import {
	formatCost,
	formatDateTime,
	formatRelative,
	formatTime,
	formatTokens,
} from "@/shared/format";
import type {
	ErrorItem,
	FinishedItem,
	MessageItem,
	ReportItem,
} from "../transcript-items";
import { Divider, PromptBubble, ResultCard } from "./parts";

export function SessionBoundary({
	number,
	at,
	model,
	prompt,
}: {
	number: number | undefined;
	at: number;
	model?: string;
	prompt: string;
}) {
	const resumed = number !== undefined && number > 1;
	return (
		<div className="flex flex-col gap-3 pt-2">
			<Divider
				title={number === undefined ? "Session" : `Session ${number}`}
				at={at}
				details={[resumed ? "resumed" : null, formatTime(at), model]}
			/>
			<PromptBubble
				label={resumed ? "Follow-up prompt" : "Prompt"}
				prompt={prompt}
				empty={resumed ? "Resumed without a new prompt." : "No prompt."}
			/>
		</div>
	);
}

/** The agent's own words. */
export function MessageBlock({ item }: { item: MessageItem }) {
	return (
		<Message>
			<MessageContent className="whitespace-pre-wrap text-sm leading-relaxed">
				{item.text}
			</MessageContent>
		</Message>
	);
}

/** The agent's step report: the outcome the flow follows, and its summary. */
export function ReportCard({
	item,
	node,
}: {
	item: ReportItem;
	node?: FlowNode;
}) {
	const { label, icon, text } = stepStateStyle(
		item.outcome,
		node && outcomeColor(node, item.outcome),
	);
	const hasSummary = item.summary.trim() !== "";
	return (
		<ResultCard icon={icon} kicker="Step report ·" value={label} tone={text}>
			{hasSummary || item.data !== undefined ? (
				<>
					{hasSummary ? (
						<p className="whitespace-pre-wrap break-words leading-relaxed">
							{item.summary}
						</p>
					) : null}
					{item.data !== undefined ? (
						<div className="flex flex-col gap-1.5">
							<p className="text-muted-foreground text-xs">Data</p>
							<JsonBlock value={item.data} />
						</div>
					) : null}
				</>
			) : null}
		</ResultCard>
	);
}

export function SessionFinished({ item }: { item: FinishedItem }) {
	const usage = item.usage;
	const parts = ["Session finished"];
	if (usage) {
		parts.push(
			`${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out`,
		);
		if (usage.costUsd !== undefined) parts.push(formatCost(usage.costUsd));
	}
	return (
		<Marker className="text-xs">
			<MarkerIcon>
				<CircleCheckIcon className="size-3.5 text-status-finished" />
			</MarkerIcon>
			<MarkerContent className="tabular-nums">
				{parts.join(" · ")}
			</MarkerContent>
		</Marker>
	);
}

export function SessionError({ item }: { item: ErrorItem }) {
	if (item.errorKind === "aborted") {
		return (
			<Marker className="text-xs">
				<MarkerIcon>
					<CircleStopIcon className="size-3.5 text-status-stopped" />
				</MarkerIcon>
				<MarkerContent>
					Stopped at {formatTime(item.at)}
					{item.message ? ` · ${item.message}` : null}
				</MarkerContent>
			</Marker>
		);
	}

	const usageLimit = item.errorKind === "usage-limit";
	const Icon = usageLimit ? ClockIcon : CircleXIcon;

	return (
		<Alert variant="destructive">
			<Icon aria-hidden="true" />
			<AlertTitle>
				{usageLimit ? "Usage limit reached" : "The agent failed"}
			</AlertTitle>
			<AlertDescription className="flex flex-col gap-1">
				<p className="whitespace-pre-wrap break-words">{item.message}</p>
				{usageLimit && item.resetAt ? (
					<p>
						Resets{" "}
						<time dateTime={new Date(item.resetAt).toISOString()}>
							{formatDateTime(item.resetAt)}
						</time>{" "}
						({formatRelative(item.resetAt)}). Resume the run after that.
					</p>
				) : null}
			</AlertDescription>
		</Alert>
	);
}
