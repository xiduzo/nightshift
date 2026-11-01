import { deadlineWhen, now } from "@nightshift/client";
import { cn } from "@nightshift/ui/lib/utils";
import { AlarmClockIcon } from "lucide-react";
import { outcomeLabel } from "@/features/flows";
import type { OpenGate } from "@/shared/api";
import { LocalTime } from "@/shared/time";

/**
 * What happens to a Gate with a deadline when nobody answers: "Night Shift
 * picks keep at 07:00 tomorrow". The time and day read as on the phone
 * (deadlineWhen of @nightshift/client). Nothing for a Gate without one.
 */
export function GateDeadline({
	deadline,
	className,
}: {
	deadline: OpenGate["deadline"];
	className?: string;
}) {
	if (!deadline) return null;
	const { time, day } = deadlineWhen(deadline.at, now());
	return (
		<p
			className={cn(
				"flex items-start gap-1.5 text-muted-foreground text-xs leading-snug",
				className,
			)}
		>
			<AlarmClockIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
			<span>
				If nobody answers, Night Shift picks{" "}
				<span className="font-medium font-mono text-foreground">
					{outcomeLabel(deadline.choose)}
				</span>{" "}
				at{" "}
				<LocalTime
					at={deadline.at}
					className="font-medium text-foreground tabular-nums"
				>
					{time}
				</LocalTime>
				{day}.
			</span>
		</p>
	);
}
