import { Link } from "@tanstack/react-router";
import { HourglassIcon, LoaderCircleIcon } from "lucide-react";
import { useOpenGates } from "@/features/gates";
import type { DashboardSummary } from "@/shared/api";
import { formatTime } from "@/shared/format";
import { LocalTime } from "@/shared/time";

/**
 * What runs and what waits for you right now, in one slim line. Only when
 * there is something: a quiet project shows nothing.
 */
export function NowStrip({
	projectId,
	summary,
}: {
	projectId: string;
	summary: DashboardSummary | undefined;
}) {
	const gates = useOpenGates();
	const waiting =
		gates.data?.filter((gate) => gate.projectId === projectId).length ?? 0;
	const running = summary?.cards.running ?? 0;
	const nextWake = summary?.cards.nextWakeAt ?? null;
	if (running === 0 && waiting === 0) return null;

	return (
		<div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-muted/40 px-4 py-2 text-sm">
			{running > 0 ? (
				<Link
					to="/projects/$projectId/runs"
					params={{ projectId }}
					className="flex items-center gap-2 hover:underline"
				>
					<LoaderCircleIcon className="size-4 animate-spin text-status-running" />
					{running} running now
				</Link>
			) : null}
			{waiting > 0 ? (
				<Link to="/inbox" className="flex items-center gap-2 hover:underline">
					<HourglassIcon className="size-4 text-status-waiting" />
					{waiting} {waiting === 1 ? "Gate waits" : "Gates wait"} for you
				</Link>
			) : null}
			{nextWake ? (
				<span className="text-muted-foreground">
					Next wake-up at{" "}
					<LocalTime at={nextWake}>{formatTime(nextWake)}</LocalTime>
				</span>
			) : null}
		</div>
	);
}
