import { LoaderCircleIcon, PinIcon, SkipForwardIcon } from "lucide-react";
import { outcomeLabel } from "../outcomes";
import type { SampleLine } from "../viewer";

/** The strip's title: what it shows, in full. */
function stripTitle(line: SampleLine): string | undefined {
	switch (line.kind) {
		case "output":
			return `${line.field}: ${line.text}`;
		case "pinned":
			return line.text === null
				? "Pinned output"
				: `Pinned output: ${line.text}`;
		case "skipped":
			return `Skipped: takes ${outcomeLabel(line.outcome)}`;
		default:
			return undefined;
	}
}

/**
 * The node's viewer: what it gave in the flow's newest run, in one line,
 * or what it gives in a test run when it is pinned or skipped. It sits at
 * the bottom of the card with a fixed height, so no handle moves and the
 * routes of the last layout hold. A click selects the node.
 */
export function SampleStrip({ line }: { line: SampleLine }) {
	return (
		<div
			className="flex h-6 min-w-0 items-center gap-1.5 rounded-b-[calc(var(--radius-xl)-1px)] border-t bg-muted/50 px-2.5 text-[11px] text-muted-foreground"
			title={stripTitle(line)}
		>
			{line.kind === "pinned" ? (
				<>
					<PinIcon className="size-3 shrink-0" aria-hidden="true" />
					<span className="sr-only">Pinned output: </span>
					<span className="truncate">{line.text ?? "Pinned output"}</span>
				</>
			) : line.kind === "skipped" ? (
				<>
					<SkipForwardIcon className="size-3 shrink-0" aria-hidden="true" />
					<span className="truncate">
						Skipped · takes {outcomeLabel(line.outcome)}
					</span>
				</>
			) : line.kind === "running" ? (
				<>
					<LoaderCircleIcon
						className="size-3 shrink-0 animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>
					Running
				</>
			) : line.kind === "absent" ? (
				<span className="truncate italic">Not in the last run</span>
			) : (
				<>
					<span className="sr-only">Last output: </span>
					<span className="truncate">{line.text}</span>
				</>
			)}
		</div>
	);
}
