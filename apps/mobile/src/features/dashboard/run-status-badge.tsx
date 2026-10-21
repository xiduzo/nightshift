import type { RunStatus } from "@nightshift/client";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import {
	CircleAlert,
	CircleCheck,
	CircleStop,
	CircleX,
	Hourglass,
	LoaderCircle,
	type LucideIcon,
	Moon,
} from "lucide-react-native";

/** A run status: its label, its icon and its color, as on the web. */
const STATUS: Record<
	RunStatus,
	{ label: string; icon: LucideIcon; badge: string; ink: string }
> = {
	running: {
		label: "Running",
		icon: LoaderCircle,
		badge: "border-status-running/40 bg-status-running/10",
		ink: "text-status-running",
	},
	waiting: {
		label: "Waiting for you",
		icon: Hourglass,
		badge: "border-status-waiting/40 bg-status-waiting/10",
		ink: "text-status-waiting",
	},
	sleeping: {
		label: "Sleeping",
		icon: Moon,
		badge: "border-status-sleeping/40 bg-status-sleeping/10",
		ink: "text-status-sleeping",
	},
	finished: {
		label: "Finished",
		icon: CircleCheck,
		badge: "border-status-finished/40 bg-status-finished/10",
		ink: "text-status-finished",
	},
	stopped: {
		label: "Stopped",
		icon: CircleStop,
		badge: "border-status-stopped/40 bg-status-stopped/10",
		ink: "text-status-stopped",
	},
	failed: {
		label: "Failed",
		icon: CircleX,
		badge: "border-status-failed/40 bg-status-failed/10",
		ink: "text-status-failed",
	},
	interrupted: {
		label: "Interrupted",
		icon: CircleAlert,
		badge: "border-status-interrupted/40 bg-status-interrupted/10",
		ink: "text-status-interrupted",
	},
};

/** How a run stands: a label and an icon, never color alone. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
	const { label, icon, badge, ink } = STATUS[status];
	return (
		<Badge variant="outline" className={badge}>
			<Icon as={icon} className={`size-3 ${ink}`} />
			<Text className={ink}>{label}</Text>
		</Badge>
	);
}
