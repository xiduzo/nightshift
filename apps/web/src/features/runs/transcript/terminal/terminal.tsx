/** A command that ran, as a terminal: the agent's shell calls and a Command step look the same. */

import { type TestRun, testCountsText } from "@nightshift/client";
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
import { SquareTerminalIcon } from "lucide-react";
import { useState } from "react";
import { CodeView } from "@/shared/code";
import { truncate } from "@/shared/format";
import { useTestRun } from "./parsed-output";
import { TerminalOutput } from "./terminal-output";

/**
 * Where a command is:
 * - `running`: it runs now.
 * - `done`: it ended well.
 * - `failed`: it ended with an error, with its exit code when known.
 * - `unfinished`: the step ended before the command did.
 */
export type TerminalState =
	| { kind: "running" }
	| { kind: "done" }
	| { kind: "failed"; exitCode?: number }
	| { kind: "unfinished" };

/** A command longer than this shows in full under the line. */
const TITLE_CHARS = 120;

/**
 * One command as a terminal line: the command as its title, and under it
 * the full command (when the title cuts it) and the output. The line opens
 * while the command runs once output arrives, and stays as you leave it.
 * A test run says how it went in the title ("Ran the tests · 2 failed"),
 * and the command moves under it.
 */
export function Terminal({
	command,
	description,
	state,
	output,
	defaultOpen = false,
	outputClassName,
}: {
	command: string;
	/** What the agent said the command is for. */
	description?: string;
	state: TerminalState;
	/** What the command wrote. Undefined while nothing came yet. */
	output: string | undefined;
	/** Open from the start, for a step that is only this command. */
	defaultOpen?: boolean;
	/** Classes for the scrolling output, such as a max height. */
	outputClassName?: string;
}) {
	const [open, setOpen] = useState<boolean>();
	const running = state.kind === "running";
	const isOpen = open ?? (defaultOpen || (running && (output ?? "") !== ""));
	const testRun = useTestRun(output, isOpen);
	const firstLine = command.trim().split("\n")[0] ?? "";
	const cut = command.trim() !== firstLine || firstLine.length > TITLE_CHARS;
	const title = truncate(firstLine, TITLE_CHARS);
	const status =
		state.kind === "running"
			? "running"
			: state.kind === "done"
				? undefined
				: "error";

	return (
		<Trace>
			<TraceCollapsible open={isOpen} onOpenChange={setOpen}>
				<TraceCollapsibleTrigger>
					<TraceLine status={status} className="text-xs">
						<TraceIcon>
							<SquareTerminalIcon className="size-3.5" />
						</TraceIcon>
						<TraceTitle>
							{testRun ? (
								<TestRunWords state={state} run={testRun} />
							) : (
								<TitleWords state={state} command={title} cut={cut} />
							)}
						</TraceTitle>
						{description ? (
							<TraceDescription className="min-w-0 shrink truncate">
								{description}
							</TraceDescription>
						) : testRun ? (
							<TraceDescription className="min-w-0 shrink truncate font-mono">
								{title}
							</TraceDescription>
						) : null}
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent className="flex flex-col gap-2 text-xs">
					{cut || testRun ? <CodeView code={command} language="bash" /> : null}
					{output === undefined ? (
						<p>{running ? "Waiting for output." : "No output."}</p>
					) : (
						<TerminalOutput
							output={output}
							command={firstLine}
							testRun={testRun}
							failed={state.kind === "failed"}
							{...(outputClassName
								? { contentClassName: outputClassName }
								: {})}
						/>
					)}
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
}

/** "Running npm test", "Ran npm test", "npm test exited with code 1". */
function TitleWords({
	state,
	command,
	cut,
}: {
	state: TerminalState;
	command: string;
	cut: boolean;
}) {
	const code = (
		<span className="font-mono">
			{command}
			{cut && !command.endsWith("…") ? " …" : null}
		</span>
	);
	switch (state.kind) {
		case "running":
			return <>Running {code}</>;
		case "done":
			return <>Ran {code}</>;
		case "failed":
			return state.exitCode === undefined ? (
				<>Failed to run {code}</>
			) : (
				<>
					{code} exited with code {state.exitCode}
				</>
			);
		case "unfinished":
			return <>Did not finish {code}</>;
	}
}

/** "Running the tests · 3 passed", "Ran the tests · 2 failed". */
function TestRunWords({ state, run }: { state: TerminalState; run: TestRun }) {
	const { summary } = run;
	const counts = testCountsText(summary);
	switch (state.kind) {
		case "running":
			return <>Running the tests · {counts}</>;
		case "unfinished":
			return <>Did not finish the tests · {counts}</>;
		default:
			return (
				<>
					Ran the tests ·{" "}
					{summary.failed > 0 ? `${summary.failed} failed` : counts}
				</>
			);
	}
}
