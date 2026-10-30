/**
 * An error and where it happened, as the Stack Trace pattern of AI Elements:
 * the error as a line, and under it the full message and the frames. The
 * frames of libraries and the runtime fold behind "Show N more frames", so
 * the frames you can fix come first.
 */
import type { StackFrame, StackTrace } from "@nightshift/client";
import { Button } from "@nightshift/ui/components/button";
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@nightshift/ui/components/trace";
import { cn } from "@nightshift/ui/lib/utils";
import { CircleXIcon } from "lucide-react";
import { useState } from "react";

/** "TypeError: Cannot read …": the type and the first line of the message. */
function errorLine(error: StackTrace["error"]): string {
	const first = error.message.split("\n")[0] ?? "";
	if (!error.type) return first;
	return first ? `${error.type}: ${first}` : error.type;
}

export function StackTraceView({ trace }: { trace: StackTrace }) {
	return (
		<Trace>
			<TraceCollapsible defaultOpen>
				<TraceCollapsibleTrigger>
					<TraceLine status="error" className="text-xs">
						<TraceIcon>
							<CircleXIcon className="size-3.5" />
						</TraceIcon>
						<TraceTitle>Failed: {errorLine(trace.error)}</TraceTitle>
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent>
					<div className="flex flex-col gap-2 rounded-md bg-muted p-3 font-mono text-xs">
						<ErrorText error={trace.error} />
						<StackFrames frames={trace.frames} />
						{trace.causes?.map((cause, index) => (
							// Causes never reorder, so the index is stable.
							<div key={index} className="flex flex-col gap-2">
								<p className="text-muted-foreground">Caused by</p>
								<ErrorText error={cause.error} />
								<StackFrames frames={cause.frames} />
							</div>
						))}
					</div>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}

/** The whole error again: the title cuts it. */
function ErrorText({ error }: { error: StackTrace["error"] }) {
	const text = error.type
		? `${error.type}${error.message ? `: ${error.message}` : ""}`
		: error.message;
	return text ? (
		<p className="whitespace-pre-wrap break-words text-destructive">{text}</p>
	) : null;
}

/** Frames in a row that are all yours, or all of libraries and the runtime. */
type FrameRun = { internal: boolean; frames: StackFrame[]; start: number };

function runsOf(frames: StackFrame[]): FrameRun[] {
	const runs: FrameRun[] = [];
	frames.forEach((frame, index) => {
		const last = runs.at(-1);
		if (last && last.internal === frame.internal) last.frames.push(frame);
		else runs.push({ internal: frame.internal, frames: [frame], start: index });
	});
	return runs;
}

/**
 * The frames, innermost first. Your frames stand out; the frames of
 * libraries and the runtime fold, unless there are no others.
 */
export function StackFrames({ frames }: { frames: StackFrame[] }) {
	if (frames.length === 0) return null;
	const fold = frames.some((frame) => !frame.internal);
	return (
		<ol className="flex flex-col gap-0.5 font-mono text-xs">
			{runsOf(frames).map((run) =>
				run.internal && fold ? (
					<FoldedFrames key={run.start} frames={run.frames} />
				) : (
					run.frames.map((frame, index) => (
						<FrameRow key={run.start + index} frame={frame} />
					))
				),
			)}
		</ol>
	);
}

function FoldedFrames({ frames }: { frames: StackFrame[] }) {
	const [open, setOpen] = useState(false);
	if (open)
		return frames.map((frame, index) => (
			// Frames never reorder, so the index is stable.
			<FrameRow key={index} frame={frame} />
		));
	return (
		<li>
			<Button
				variant="link"
				size="xs"
				className="h-auto px-0 font-sans text-muted-foreground"
				onClick={() => setOpen(true)}
			>
				Show {frames.length} more {frames.length === 1 ? "frame" : "frames"}
			</Button>
		</li>
	);
}

/** `getUser  src/users.ts:12:23`: the function, then where it is. */
function FrameRow({ frame }: { frame: StackFrame }) {
	const place = frame.file
		? `${frame.file}${frame.line === undefined ? "" : `:${frame.line}`}${frame.column === undefined ? "" : `:${frame.column}`}`
		: undefined;
	if (!frame.fn && !place)
		return <li className="text-muted-foreground">{frame.text}</li>;
	return (
		<li
			className={cn(
				"flex min-w-0 flex-wrap gap-x-2",
				frame.internal ? "text-muted-foreground" : "text-foreground",
			)}
		>
			{frame.fn ? <span className="break-all">{frame.fn}</span> : null}
			{place ? (
				<span className="break-all text-muted-foreground">{place}</span>
			) : null}
		</li>
	);
}
