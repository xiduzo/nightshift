import { type ToolKind, toolKind } from "@nightshift/client";
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
	FilePenIcon,
	FileTextIcon,
	GlobeIcon,
	type LucideIcon,
	PlugIcon,
	SearchIcon,
	SquareTerminalIcon,
	WrenchIcon,
} from "lucide-react";
import { memo } from "react";

import { CodeView } from "@/shared/code";
import { truncate } from "@/shared/format";
import { formatToolInput, summarizeToolInput } from "../transcript";
import type { ToolItem } from "../transcript-items";
import {
	isLongOutput,
	OutputSheet,
	PREVIEW_CHARS,
	PREVIEW_LINES,
} from "./output-sheet";
import { Terminal, type TerminalState } from "./terminal";

/** A recognisable icon for each kind of tool. */
const KIND_ICON: Record<ToolKind, LucideIcon> = {
	command: SquareTerminalIcon,
	read: FileTextIcon,
	edit: FilePenIcon,
	search: SearchIcon,
	web: GlobeIcon,
	other: WrenchIcon,
};

/** How a call of each kind reads while it runs, once it ran, and when it failed. */
const KIND_VERBS: Record<
	Exclude<ToolKind, "other">,
	[running: string, done: string, failed: string]
> = {
	command: ["Running", "Ran", "Failed to run"],
	read: ["Reading", "Read", "Failed to read"],
	edit: ["Editing", "Edited", "Failed to edit"],
	search: ["Searching for", "Searched for", "Failed to search for"],
	web: ["Opening", "Opened", "Failed to open"],
};

/** The command a shell tool ran, when its input has one. */
function commandOf(input: unknown): string | null {
	if (input && typeof input === "object" && "command" in input) {
		const command = (input as { command: unknown }).command;
		if (typeof command === "string") return command;
		// Codex passes the command as its argv.
		if (
			Array.isArray(command) &&
			command.every((part) => typeof part === "string")
		) {
			return command.join(" ");
		}
	}
	return null;
}

/** What the agent said a shell command is for, when its input says so. */
function descriptionOf(input: unknown): string | undefined {
	if (input && typeof input === "object" && "description" in input) {
		const description = (input as { description: unknown }).description;
		if (typeof description === "string" && description.trim() !== "")
			return description;
	}
	return undefined;
}

/** Where a call is: it runs, it ran, it failed, or the step ended before it did. */
function callState(item: ToolItem, running: boolean): TerminalState {
	if (item.result === undefined)
		return running ? { kind: "running" } : { kind: "unfinished" };
	return item.failed ? { kind: "failed" } : { kind: "done" };
}

/**
 * One tool call. A shell command is a terminal: the command, then its
 * output. Any other call is a tool line: what it did and what it acted on.
 * It opens on the full input and result.
 */
export const ToolCallRow = memo(function ToolCallRow({
	item,
	running,
}: {
	item: ToolItem;
	/** The run is still running, so a call without a result is in progress. */
	running: boolean;
}) {
	const kind: ToolKind =
		item.connection !== undefined ? "other" : toolKind(item.name);
	const command = item.hasInput ? commandOf(item.input) : null;
	const state = callState(item, running);
	if (kind === "command" && command !== null) {
		const description = descriptionOf(item.input);
		return (
			<Terminal
				command={command}
				state={state}
				output={item.result}
				{...(description ? { description } : {})}
			/>
		);
	}
	return <ToolLine item={item} kind={kind} state={state} />;
});

function ToolLine({
	item,
	kind,
	state,
}: {
	item: ToolItem;
	kind: ToolKind;
	state: TerminalState;
}) {
	const summary = item.hasInput ? summarizeToolInput(item.input) : "";
	const target = truncate(summary.replace(/\s+/g, " "), 200);
	// A Tool node's call shows its connection; an agent's tool call, the tool.
	const Icon = item.connection !== undefined ? PlugIcon : KIND_ICON[kind];
	const status =
		state.kind === "running"
			? "running"
			: state.kind === "done"
				? undefined
				: "error";
	const name = item.connection
		? `${item.connection} › ${item.name}`
		: item.name;
	const verbs = kind === "other" ? KIND_VERBS.command : KIND_VERBS[kind];
	const verb =
		state.kind === "running"
			? verbs[0]
			: state.kind === "done"
				? verbs[1]
				: verbs[2];
	// A known kind names what it acted on; any other tool names itself, and what it acted on follows.
	const known = kind !== "other" && target !== "";

	return (
		<Trace>
			<TraceCollapsible>
				<TraceCollapsibleTrigger>
					<TraceLine status={status} className="text-xs">
						<TraceIcon>
							<Icon className="size-3.5" />
						</TraceIcon>
						<TraceTitle>
							{verb} <span className="font-mono">{known ? target : name}</span>
						</TraceTitle>
						{!known && target !== "" ? (
							<TraceDescription className="min-w-0 shrink truncate font-mono">
								{target}
							</TraceDescription>
						) : null}
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent className="flex flex-col gap-3 text-xs">
					<section className="flex flex-col gap-1.5">
						<h4 className="font-medium">Input</h4>
						{item.hasInput ? (
							<CodeView code={formatToolInput(item.input)} language="json" />
						) : (
							<p>Not received yet.</p>
						)}
					</section>
					<section className="flex flex-col gap-1.5">
						<h4 className="font-medium">Result</h4>
						{item.result === undefined ? (
							<p>
								{state.kind === "running"
									? "Waiting for the result."
									: "No result."}
							</p>
						) : (
							<ToolResult content={item.result} title={known ? target : name} />
						)}
					</section>
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}

/** A call's result: its start in the transcript, and all of it in a sheet when it is long. */
function ToolResult({ content, title }: { content: string; title: string }) {
	if (content.trim() === "") {
		return <p>Empty.</p>;
	}
	const long = isLongOutput(content);
	const shown = long
		? truncate(
				content.split("\n").slice(0, PREVIEW_LINES).join("\n"),
				PREVIEW_CHARS,
			)
		: content;
	return (
		<div className="flex flex-col items-start gap-1">
			<CodeView code={shown} language="text" className="w-full" />
			{long ? (
				<OutputSheet title={title} content={content} language="text" />
			) : null}
		</div>
	);
}
