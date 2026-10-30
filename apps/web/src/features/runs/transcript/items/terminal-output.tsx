import { CodeView } from "@/shared/code";
import { OutputSheet } from "./output-sheet";

/** The most lines and characters the transcript shows of an output: its end, where results and errors are. */
const TAIL_LINES = 200;
const TAIL_CHARS = 40_000;

/**
 * The output area of a terminal: what a command wrote, its ANSI colours
 * kept, in a box that scrolls. Very long output shows its end, and "Show
 * all" opens the whole output in a sheet.
 *
 * This is the seam for parsed output. When the output parses as test
 * results or as a stack trace, a view of those goes here in place of the
 * plain lines. Keep the props: the output and what ran.
 */
export function TerminalOutput({
	output,
	command,
	contentClassName,
}: {
	output: string;
	/** What ran: names the sheet with the whole output. */
	command: string;
	/** Classes for the scrolling code, such as a max height. */
	contentClassName?: string;
}) {
	if (output.trim() === "") {
		return <p className="text-xs">No output.</p>;
	}
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
