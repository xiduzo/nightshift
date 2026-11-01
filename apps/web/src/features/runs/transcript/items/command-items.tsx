/** The items of a Command step: the command as a terminal, with its output and its exit. */
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import { formatTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";
import type { CommandItem, ExitItem, LogItem } from "../transcript-items";
import { Terminal, type TerminalState } from "./terminal";
import { TerminalOutput } from "./terminal-output";

/** All a command wrote, in order. */
function logText(log: LogItem): string {
	return log.chunks.map((chunk) => chunk.text).join("");
}

/**
 * A Command step's command as a terminal, open from the start: the command,
 * then what it wrote as it streamed, then how it ended.
 */
export function CommandRun({
	command,
	log,
	exit,
	running,
}: {
	command: CommandItem;
	log?: LogItem;
	exit?: ExitItem;
	/** The step still runs. */
	running: boolean;
}) {
	const state: TerminalState = exit
		? exit.exitCode === 0
			? { kind: "done" }
			: exit.exitCode === null
				? { kind: "failed" }
				: { kind: "failed", exitCode: exit.exitCode }
		: running
			? { kind: "running" }
			: { kind: "unfinished" };
	return (
		<Terminal
			command={command.command}
			state={state}
			output={log ? logText(log) : undefined}
			defaultOpen
			outputClassName="max-h-[36rem]"
		/>
	);
}

/** Output with no command before it. */
export function CommandLog({ item }: { item: LogItem }) {
	return <TerminalOutput output={logText(item)} command="Output" />;
}

/** An exit with no command before it. */
export function CommandExit({ item }: { item: ExitItem }) {
	const passed = item.exitCode === 0;
	return (
		<Marker className="text-xs">
			<MarkerIcon>
				{passed ? (
					<CircleCheckIcon className="size-3.5 text-outcome-pass" />
				) : (
					<CircleXIcon className="size-3.5 text-outcome-fail" />
				)}
			</MarkerIcon>
			<MarkerContent>
				{item.exitCode === null
					? "The command ended without a result"
					: passed
						? "The command succeeded"
						: `The command failed with code ${item.exitCode}`}{" "}
				· <LocalTime at={item.at}>{formatTime(item.at)}</LocalTime>
			</MarkerContent>
		</Marker>
	);
}
