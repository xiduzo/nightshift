import type { TestRun } from "@nightshift/client";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { type ReactNode, useState } from "react";
import { CodeView } from "@/shared/code";
import { OutputSheet } from "./output-sheet";
import { useStackTrace, useTestRun } from "./parsed-output";
import { StackTraceView } from "./stack-trace";
import { TestResults } from "./test-results";

/** The most lines and characters the transcript shows of an output: its end, where results and errors are. */
const TAIL_LINES = 200;
const TAIL_CHARS = 40_000;

/**
 * The output area of a terminal. A test run shows as test results, and the
 * output of a failed command with a stack trace shows as that error. Each
 * keeps the plain output a click away. Plain output keeps its ANSI colours,
 * in a box that scrolls. Very long output shows its end, and "Show all"
 * opens the whole output in a sheet.
 *
 * It renders only while its terminal is open, so it reads the output only
 * then.
 */
export function TerminalOutput({
	output,
	command,
	contentClassName,
	testRun,
	failed = false,
}: {
	output: string;
	/** What ran: names the sheet with the whole output. */
	command: string;
	/** Classes for the scrolling code, such as a max height. */
	contentClassName?: string;
	/** The test run the terminal already read from `output`. Undefined: read it here. */
	testRun?: TestRun | null;
	/** The command failed: its output may hold the error's trace. */
	failed?: boolean;
}) {
	const own = useTestRun(testRun === undefined ? output : undefined, true);
	const run = testRun === undefined ? own : testRun;
	const trace = useStackTrace(failed && !run ? output : undefined);

	if (output.trim() === "") {
		return <p className="text-xs">No output.</p>;
	}
	const plain = (
		<PlainOutput
			output={output}
			command={command}
			{...(contentClassName ? { contentClassName } : {})}
		/>
	);
	if (run)
		return (
			<OutputViews read="Results" plain={plain}>
				<TestResults run={run} />
			</OutputViews>
		);
	if (trace)
		return (
			<OutputViews read="Error" plain={plain}>
				<StackTraceView trace={trace} />
			</OutputViews>
		);
	return plain;
}

/** What the output says, read, or the output as it came: you choose. */
export function OutputViews({
	read,
	plain,
	children,
}: {
	/** The name of the read view: "Results", "Error". */
	read: string;
	plain: ReactNode;
	children: ReactNode;
}) {
	const [view, setView] = useState<"read" | "plain">("read");
	return (
		<div className="flex flex-col gap-2">
			<ToggleGroup
				variant="outline"
				size="sm"
				spacing={0}
				value={[view]}
				onValueChange={(next: string[]) => {
					const pick = next[0];
					if (pick === "read" || pick === "plain") setView(pick);
				}}
				aria-label="How to show the output"
			>
				<ToggleGroupItem value="read">{read}</ToggleGroupItem>
				<ToggleGroupItem value="plain">Output</ToggleGroupItem>
			</ToggleGroup>
			{view === "read" ? children : plain}
		</div>
	);
}

/** The output as it came, its end when it is long. */
function PlainOutput({
	output,
	command,
	contentClassName,
}: {
	output: string;
	command: string;
	contentClassName?: string;
}) {
	const shown = tail(output);
	return (
		<div className="flex flex-col items-start gap-1">
			<CodeView
				code={shown}
				language="ansi"
				className="w-full"
				contentClassName={contentClassName ?? "max-h-64"}
			/>
			{shown !== output ? (
				<OutputSheet title={command} content={output} language="ansi" />
			) : null}
		</div>
	);
}

/** The end of a long output; a short output as it is. */
function tail(output: string): string {
	const lines = output.split("\n");
	const kept =
		lines.length > TAIL_LINES ? lines.slice(-TAIL_LINES).join("\n") : output;
	return kept.length > TAIL_CHARS ? kept.slice(-TAIL_CHARS) : kept;
}
