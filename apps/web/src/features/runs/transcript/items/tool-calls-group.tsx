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
import type { ThinkingItem, ToolItem } from "../transcript-items";
import { Reasoning } from "./reasoning";
import { ToolCallRow } from "./tool-call-row";

/**
 * Two or more tool calls in a row, as one line that says what they did:
 * "Ran 6 commands · read 3 files". It opens on the calls, one line each.
 * It is open while its last call runs, and stays as you leave it. The
 * thoughts around and between the calls are steps inside it.
 */
export const ToolCallsGroup = memo(function ToolCallsGroup({
	items,
	running,
	projectRoot,
}: {
	items: (ToolItem | ThinkingItem)[];
	/** The run is still running, so a call without a result is in progress. */
	running: boolean;
	/** The project's folder of the run, to show paths relative to it. */
	projectRoot?: string | undefined;
}) {
	const [open, setOpen] = useState<boolean>();
	const calls = items.filter((item) => item.kind === "tool");
	const last = items.at(-1);
	const busy =
		running &&
		(last?.kind === "thinking" ? !last.done : last?.result === undefined);
	const failed = calls.filter((item) => item.failed).length;
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
							{toolCallsSummary(calls.map((item) => item.name))}
						</TraceTitle>
						{failed > 0 ? (
							<TraceDescription>· {failed} failed</TraceDescription>
						) : null}
					</TraceLine>
				</TraceCollapsibleTrigger>
				<TraceCollapsibleContent keepMounted className="flex flex-col gap-2">
					{items.map((item) =>
						item.kind === "thinking" ? (
							<Reasoning key={item.key} item={item} running={running} />
						) : (
							<ToolCallRow
								key={item.key}
								item={item}
								running={running}
								projectRoot={projectRoot}
							/>
						),
					)}
				</TraceCollapsibleContent>
			</TraceCollapsible>
		</Trace>
	);
});
