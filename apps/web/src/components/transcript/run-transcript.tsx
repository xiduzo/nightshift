import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
} from "@nightshift/ui/components/message-scroller";
import {
	CircleCheckIcon,
	CircleStopIcon,
	CircleXIcon,
	ClockIcon,
	LoaderCircleIcon,
} from "lucide-react";
import { memo } from "react";

import type { RunDetail, SessionSummary } from "@/lib/api-types";
import {
	formatCost,
	formatDateTime,
	formatRelative,
	formatTime,
	formatTokens,
} from "@/lib/format";
import type {
	ErrorItem,
	FinishedItem,
	MessageItem,
	SessionItem,
	TranscriptItem,
	TranscriptState,
} from "@/lib/transcript";

import { ToolCallRow } from "./tool-call-row";

export function RunTranscript({
	run,
	transcript,
	running,
	connecting,
}: {
	run: RunDetail;
	transcript: TranscriptState;
	running: boolean;
	/** The first replay has not arrived yet. */
	connecting: boolean;
}) {
	const sessionNumbers = new Map(
		run.sessions.map((session, position) => [session.id, position + 1]),
	);
	const sessionsById = new Map(
		run.sessions.map((session) => [session.id, session]),
	);
	// Sessions the engine knows about but that have no transcript entries yet,
	// for example one that was resumed a moment ago.
	const seen = new Set(
		transcript.items
			.filter((item) => item.kind === "session")
			.map((item) => item.sessionId),
	);
	const pendingSessions = run.sessions.filter(
		(session) => !seen.has(session.id),
	);
	const isEmpty = transcript.items.length === 0 && pendingSessions.length === 0;

	return (
		<MessageScrollerProvider autoScroll defaultScrollPosition="end">
			<MessageScroller className="min-h-0">
				<MessageScrollerViewport aria-label="Transcript">
					<MessageScrollerContent
						aria-live="off"
						className="mx-auto w-full max-w-4xl gap-3 px-4 py-4"
					>
						{transcript.items.map((item) => (
							<MessageScrollerItem key={item.key} messageId={item.key}>
								<TranscriptItemView
									item={item}
									running={running}
									session={sessionsById.get(item.sessionId)}
									sessionNumber={sessionNumbers.get(item.sessionId)}
									runPrompt={run.prompt}
								/>
							</MessageScrollerItem>
						))}
						{pendingSessions.map((session) => (
							<MessageScrollerItem
								key={`pending:${session.id}`}
								messageId={`pending:${session.id}`}
							>
								<SessionBoundary
									number={sessionNumbers.get(session.id)}
									at={session.createdAt}
									prompt={session.prompt}
								/>
							</MessageScrollerItem>
						))}
						{isEmpty ? (
							<p className="py-8 text-center text-muted-foreground text-xs">
								{connecting ? "Loading transcript…" : "No transcript yet."}
							</p>
						) : null}
						{running ? (
							<Marker className="py-1">
								<MarkerIcon>
									<LoaderCircleIcon className="animate-spin text-status-running motion-reduce:animate-none" />
								</MarkerIcon>
								<MarkerContent>The agent is working…</MarkerContent>
							</Marker>
						) : null}
					</MessageScrollerContent>
				</MessageScrollerViewport>
				<MessageScrollerButton />
			</MessageScroller>
		</MessageScrollerProvider>
	);
}

const TranscriptItemView = memo(function TranscriptItemView({
	item,
	running,
	session,
	sessionNumber,
	runPrompt,
}: {
	item: TranscriptItem;
	running: boolean;
	session: SessionSummary | undefined;
	sessionNumber: number | undefined;
	runPrompt: string;
}) {
	switch (item.kind) {
		case "session":
			return (
				<SessionStart
					item={item}
					number={sessionNumber}
					prompt={session?.prompt ?? (sessionNumber === 1 ? runPrompt : "")}
				/>
			);
		case "message":
			return <MessageBlock item={item} />;
		case "tool":
			return <ToolCallRow item={item} running={running} />;
		case "finished":
			return <SessionFinished item={item} />;
		case "error":
			return <SessionError item={item} />;
	}
});

function SessionStart({
	item,
	number,
	prompt,
}: {
	item: SessionItem;
	number: number | undefined;
	prompt: string;
}) {
	return (
		<SessionBoundary
			number={number}
			at={item.at}
			model={item.model}
			prompt={prompt}
		/>
	);
}

function SessionBoundary({
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
	const title = number === undefined ? "Session" : `Session ${number}`;
	const details = [
		resumed ? "resumed" : null,
		formatTime(at),
		model ?? null,
	].filter(Boolean);

	return (
		<div className="flex flex-col gap-2 pt-2">
			<Marker variant="separator">
				<MarkerContent>
					<h3 className="inline font-medium text-foreground">{title}</h3>
					<span title={formatDateTime(at)}> · {details.join(" · ")}</span>
				</MarkerContent>
			</Marker>
			<div className="border-primary/40 border-l-2 bg-muted/40 px-3 py-2">
				<p className="mb-1 text-muted-foreground text-xs">
					{resumed ? "Follow-up prompt" : "Prompt"}
				</p>
				{prompt.trim() === "" ? (
					<p className="text-muted-foreground text-sm italic">
						Resumed without a new prompt.
					</p>
				) : (
					<p className="whitespace-pre-wrap break-words text-sm">{prompt}</p>
				)}
			</div>
		</div>
	);
}

function MessageBlock({ item }: { item: MessageItem }) {
	return (
		<div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
			{item.text}
		</div>
	);
}

function SessionFinished({ item }: { item: FinishedItem }) {
	const usage = item.usage;
	const parts = ["Session finished"];
	if (usage) {
		parts.push(
			`${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out`,
		);
		if (usage.costUsd !== undefined) parts.push(formatCost(usage.costUsd));
	}
	return (
		<Marker>
			<MarkerIcon>
				<CircleCheckIcon className="text-status-finished" />
			</MarkerIcon>
			<MarkerContent>{parts.join(" · ")}</MarkerContent>
		</Marker>
	);
}

function SessionError({ item }: { item: ErrorItem }) {
	if (item.errorKind === "aborted") {
		return (
			<Marker>
				<MarkerIcon>
					<CircleStopIcon />
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
		<div className="flex gap-2 border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive text-sm">
			<Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<div className="flex min-w-0 flex-col gap-1">
				<p className="font-medium">
					{usageLimit ? "Usage limit reached" : "The agent failed"}
				</p>
				<p className="whitespace-pre-wrap break-words text-xs">
					{item.message}
				</p>
				{usageLimit && item.resetAt ? (
					<p className="text-xs">
						Resets{" "}
						<time dateTime={new Date(item.resetAt).toISOString()}>
							{formatDateTime(item.resetAt)}
						</time>{" "}
						({formatRelative(item.resetAt)}). Resume the run after that.
					</p>
				) : null}
			</div>
		</div>
	);
}
