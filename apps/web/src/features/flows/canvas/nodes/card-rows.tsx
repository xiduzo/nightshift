import type { EndStatus } from "@nightshift/flows";
import { cn } from "@nightshift/ui/lib/utils";
import { MonitorIcon } from "lucide-react";
import { useDeviceLabel } from "./device-names-context";
import { END_STATUS_LABEL } from "./node-type";

/**
 * How an End node ends the run, where other nodes list their outcomes:
 * no edge leaves it, so no handle. In a run, it lights up once reached.
 */
export function EndRow({
	status,
	message,
	reached,
}: {
	status: EndStatus;
	message: string | undefined;
	/** Run view only: whether the run ended here. */
	reached: boolean | undefined;
}) {
	const tone =
		status === "failed"
			? "text-destructive"
			: status === "done"
				? "text-status-finished"
				: "text-muted-foreground";
	return (
		<div
			className={cn(
				"flex flex-col gap-0.5 border-t border-dashed px-3.5 py-1.5 text-[11px]",
				reached === false && "opacity-35",
			)}
		>
			<span className={cn("font-medium", tone)}>
				Ends: {END_STATUS_LABEL[status].toLowerCase()}
			</span>
			{message?.trim() ? (
				<span className="truncate text-muted-foreground" title={message}>
					{message}
				</span>
			) : null}
		</div>
	);
}

/** The computer a Subflow's steps run on, by its name. */
export function SubflowDevice({ device }: { device: string }) {
	const name = useDeviceLabel(device);
	return (
		<span
			className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
			title={`Its steps run on ${name}`}
		>
			<MonitorIcon className="size-3 shrink-0" aria-hidden="true" />
			<span className="truncate">On {name}</span>
		</span>
	);
}
