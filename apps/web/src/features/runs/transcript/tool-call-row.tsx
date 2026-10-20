import { Button } from "@nightshift/ui/components/button";
import { Spinner } from "@nightshift/ui/components/spinner";
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
import {
	CheckIcon,
	FilePenIcon,
	FileTextIcon,
	GlobeIcon,
	type LucideIcon,
	PlugIcon,
	SearchIcon,
	SquareTerminalIcon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import { memo, useState } from "react";

import { CodeView } from "@/shared/code";
import { truncate } from "@/shared/format";
import {
	formatToolInput,
	summarizeToolInput,
	type ToolItem,
} from "./transcript";

const RESULT_PREVIEW_CHARS = 1500;
const RESULT_PREVIEW_LINES = 20;

/** A recognisable icon for the common harness tools; a wrench for the rest. */
function toolIcon(name: string): LucideIcon {
	const lower = name.toLowerCase();
	if (lower === "bash" || lower.includes("shell") || lower.includes("exec"))
		return SquareTerminalIcon;
	if (lower === "read" || lower.includes("view")) return FileTextIcon;
	if (lower.includes("edit") || lower.includes("write")) return FilePenIcon;
	if (lower.includes("grep") || lower.includes("glob") || lower === "search")
		return SearchIcon;
	if (lower.includes("web") || lower.includes("fetch")) return GlobeIcon;
	return WrenchIcon;
}

/** The command a shell tool ran, when its input has one. */
function commandOf(input: unknown): string | null {
	if (input && typeof input === "object" && "command" in input) {
		const command = (input as { command: unknown }).command;
		if (typeof command === "string") return command;
	}
	return null;
}

/**
 * One tool call as a trace line: icon, tool name, the argument it acts on,
 * and whether it is still running. It opens on the full input and result.
 */
export const ToolCallRow = memo(function ToolCallRow({
	item,
	running,
}: {
	item: ToolItem;
	/** The run is still running, so a call without a result is in progress. */
	running: boolean;
}) {
	const summary = item.hasInput ? summarizeToolInput(item.input) : "";
	const inProgress = running && item.result === undefined;
	// A Tool node's call shows its connection; an agent's tool call, the tool.
	const Icon = item.connection !== undefined ? PlugIcon : toolIcon(item.name);
	const command = item.hasInput ? commandOf(item.input) : null;

	return (
		<Trace>
			<TraceCollapsible>
				<TraceCollapsibleTrigger className="w-full">
					<TraceLine
						status={
							inProgress
								? "running"
								: item.result === undefined
									? "pending"
									: undefined
						}
						className="w-full text-xs"
					>
						<TraceIcon>
							<Icon className="size-3.5" />
						</TraceIcon>
						<TraceTitle className="shrink-0 font-medium font-mono text-foreground">
							{item.connection ? (
								<>
									<span className="font-normal text-muted-foreground">
										{item.connection} ›{" "}
									</span>
									{item.name}
								</>
							) : (
								item.name
							)}
						</TraceTitle>
						<TraceDescription className="min-w-0 shrink truncate font-mono">
							{truncate(summary.replace(/\s+/g, " "), 200)}
						</TraceDescription>
						{inProgress ? (
							<Spinner
								className="size-3.5 text-status-running"
								aria-label="In progress"
							/>
						) : item.failed ? (
							<XIcon
								className="size-3.5 shrink-0 text-destructive"
								aria-label="Failed"
							/>
						) : item.result !== undefined ? (
							<CheckIcon
								className="size-3.5 shrink-0 text-status-finished"
								aria-label="Done"
							/>
						) : null}
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent className="flex flex-col gap-3 text-xs">
					<section className="flex flex-col gap-1.5">
						<h4 className="font-medium">Input</h4>
						{item.hasInput ? (
							command !== null ? (
								<CodeView code={command} language="bash" />
							) : (
								<CodeView code={formatToolInput(item.input)} language="json" />
							)
						) : (
							<p>Not received yet.</p>
						)}
					</section>
					<section className="flex flex-col gap-1.5">
						<h4 className="font-medium">Result</h4>
						{item.result === undefined ? (
							<p>{inProgress ? "Waiting for the result." : "No result."}</p>
						) : (
							<ToolResult content={item.result} />
						)}
					</section>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
});

function ToolResult({ content }: { content: string }) {
	const [expanded, setExpanded] = useState(false);
	const lines = content.split("\n");
	const tooLong =
		content.length > RESULT_PREVIEW_CHARS ||
		lines.length > RESULT_PREVIEW_LINES;
	const shown =
		expanded || !tooLong
			? content
			: truncate(
					lines.slice(0, RESULT_PREVIEW_LINES).join("\n"),
					RESULT_PREVIEW_CHARS,
				);

	if (content.trim() === "") {
		return <p>Empty.</p>;
	}

	return (
		<div className="flex flex-col items-start gap-1">
			<CodeView code={shown} language="text" contentClassName="max-h-[32rem]" />
			{tooLong ? (
				<Button
					variant="link"
					size="xs"
					className="px-0"
					onClick={() => setExpanded((value) => !value)}
				>
					{expanded
						? "Show less"
						: `Show all (${lines.length} lines, ${content.length.toLocaleString()} characters)`}
				</Button>
			) : null}
		</div>
	);
}
