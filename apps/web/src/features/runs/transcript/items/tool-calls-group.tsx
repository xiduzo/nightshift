import { toolCallsSummary } from "@nightshift/client";
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
import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon } from "lucide-react";
import { memo, useState } from "react";
import type { ToolItem } from "../transcript-items";
import { ToolCallRow } from "./tool-call-row";

/**
 * Two or more tool calls in a row, as one line that says what they did:
 * "Ran 6 commands · read 3 files". It opens on the calls, one line each.
 * It is open while its last call runs, and stays as you leave it.
 */
export const ToolCallsGroup = memo(function ToolCallsGroup({
	items,
	running,
}: {
	items: ToolItem[];
	/** The run is still running, so a call without a result is in progress. */
	running: boolean;
}) {
	const [open, setOpen] = useState<boolean>();
	const busy = running && items.at(-1)?.result === undefined;
	const failed = items.filter((item) => item.failed).length;
	const status = busy ? "running" : failed > 0 ? "error" : undefined;
	const Icon = busy
		? LoaderCircleIcon
		: failed > 0
			? CircleXIcon
			: CircleCheckIcon;

	return (
		<Trace>
			<TraceCollapsible open={open ?? busy} onOpenChange={setOpen}>
				<TraceCollapsibleTrigger>
					<TraceLine status={status} className="text-xs">
						<TraceIcon>
							<Icon
								className={
									busy
										? "size-3.5 animate-spin motion-reduce:animate-none"
										: "size-3.5"
								}
							/>
						</TraceIcon>
						<TraceTitle>
							{toolCallsSummary(items.map((item) => item.name))}
						</TraceTitle>
						{failed > 0 ? (
							<TraceDescription>· {failed} failed</TraceDescription>
						) : null}
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent keepMounted className="flex flex-col gap-2">
					{items.map((item) => (
						<ToolCallRow key={item.key} item={item} running={running} />
					))}
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
});
