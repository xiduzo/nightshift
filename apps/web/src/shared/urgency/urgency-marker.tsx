import { URGENCY_LABEL } from "@nightshift/client";
import type { GateUrgency } from "@nightshift/flows";
import { cn } from "@nightshift/ui/lib/utils";
import { SignalHighIcon, SignalLowIcon, SignalMediumIcon } from "lucide-react";

const LOOK: Record<GateUrgency, { icon: typeof SignalHighIcon; text: string }> =
	{
		now: { icon: SignalHighIcon, text: "text-status-failed" },
		today: { icon: SignalMediumIcon, text: "text-status-waiting" },
		later: { icon: SignalLowIcon, text: "text-muted-foreground" },
	};

/**
 * The small level mark of a Gate's urgency: three bars for Now, two for
 * Today, one for When you have time. `quiet` greys it, for answered Gates.
 */
export function UrgencyMarker({
	urgency,
	quiet = false,
	className,
}: {
	urgency: GateUrgency;
	quiet?: boolean;
	className?: string;
}) {
	const { icon: Icon, text } = LOOK[urgency];
	return (
		<Icon
			role="img"
			aria-label={URGENCY_LABEL[urgency]}
			className={cn(
				"size-3.5 shrink-0",
				quiet ? "text-muted-foreground/60" : text,
				className,
			)}
		/>
	);
}
