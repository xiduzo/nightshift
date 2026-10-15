import { Button } from "@nightshift/ui/components/button";
import { ChevronRightIcon, LoaderCircleIcon, WrenchIcon } from "lucide-react";
import { memo, useState } from "react";

import { truncate } from "@/lib/format";
import {
	formatToolInput,
	summarizeToolInput,
	type ToolItem,
} from "@/lib/transcript";

const RESULT_PREVIEW_CHARS = 1500;
const RESULT_PREVIEW_LINES = 20;

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

	return (
		<details className="group/tool border bg-card/40 text-xs">
			<summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1.5 outline-none hover:bg-muted/50 focus-visible:ring-1 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
				<ChevronRightIcon
					className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/tool:rotate-90 motion-reduce:transition-none"
					aria-hidden="true"
				/>
				<WrenchIcon
					className="size-3.5 shrink-0 text-muted-foreground"
					aria-hidden="true"
				/>
				<span className="shrink-0 font-medium font-mono">{item.name}</span>
				<span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
					{truncate(summary.replace(/\s+/g, " "), 200)}
				</span>
				{inProgress ? (
					<LoaderCircleIcon
						className="size-3.5 shrink-0 animate-spin text-status-running motion-reduce:animate-none"
						aria-label="In progress"
					/>
				) : null}
			</summary>
			<div className="flex flex-col gap-2 border-t px-2 py-2">
				<section className="flex flex-col gap-1">
					<h4 className="text-muted-foreground">Input</h4>
					{item.hasInput ? (
						<pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-muted/40 p-2 font-mono">
							{formatToolInput(item.input)}
						</pre>
					) : (
						<p className="text-muted-foreground">Not received yet.</p>
					)}
				</section>
				<section className="flex flex-col gap-1">
					<h4 className="text-muted-foreground">Result</h4>
					{item.result === undefined ? (
						<p className="text-muted-foreground">
							{inProgress ? "Waiting for the result." : "No result."}
						</p>
					) : (
						<ToolResult content={item.result} />
					)}
				</section>
			</div>
		</details>
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
		return <p className="text-muted-foreground">Empty.</p>;
	}

	return (
		<div className="flex flex-col items-start gap-1">
			<pre className="max-h-[32rem] w-full overflow-auto whitespace-pre-wrap break-words bg-muted/40 p-2 font-mono">
				{shown}
			</pre>
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
