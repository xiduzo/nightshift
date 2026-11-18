/** What the model thought: the Reasoning pattern of AI Elements, on Trace. */
import {
	Trace,
	TraceCollapsible,
	TraceCollapsibleContent,
	TraceCollapsibleTrigger,
	TraceIcon,
	TraceLine,
	TraceTitle,
} from "@nightshift/ui/components/trace";
import { BrainIcon } from "lucide-react";
import { memo, useState } from "react";
import { Markdown } from "@/shared/markdown";
import { thoughtTitle } from "../transcript";
import type { ThinkingItem } from "../transcript-items";

/**
 * One thought. While the model thinks it reads "Thinking…" and is open on
 * the text. Once the thought is over it closes to "Thought for 12s" and
 * opens on the text as Markdown. Your own open or close wins.
 */
const ReasoningLine = memo(function ReasoningLine({
	item,
	running,
}: {
	item: ThinkingItem;
	/** The step still runs, so a thought that nothing followed yet streams. */
	running: boolean;
}) {
	const [open, setOpen] = useState<boolean>();
	const thinking = running && !item.done;
	return (
		<TraceCollapsible open={open ?? thinking} onOpenChange={setOpen}>
			<TraceCollapsibleTrigger>
				<TraceLine
					status={thinking ? "running" : undefined}
					className="text-xs"
				>
					<TraceIcon>
						<BrainIcon className="size-3.5" />
					</TraceIcon>
					<TraceTitle>{thinking ? "Thinking…" : thoughtTitle(item)}</TraceTitle>
				</TraceLine>
			</TraceCollapsibleTrigger>
			<TraceCollapsibleContent keepMounted className="text-xs">
				<Markdown text={item.text} className="max-w-none text-xs" />
			</TraceCollapsibleContent>
		</TraceCollapsible>
	);
});

/** A thought as its own part of the transcript. */
export function Reasoning({
	item,
	running,
}: {
	item: ThinkingItem;
	running: boolean;
}) {
	return (
		<Trace>
			<ReasoningLine item={item} running={running} />
		</Trace>
	);
}
