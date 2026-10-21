import {
	type RunStatus,
	runStatusLabel,
	type StepState,
} from "@nightshift/client";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { cn } from "@nightshift/ui-native/lib/utils";
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

type Look = { label: string; icon: LucideIcon; box: string; text: string };

/** A run status: its label (`runStatusLabel`), icon and color, as the web shows it. */
const RUN: Record<RunStatus, Look> = {
	running: {
		label: runStatusLabel("running"),
		icon: LoaderCircle,
		box: "border-status-running/40 bg-status-running/10",
		text: "text-status-running",
	},
	waiting: {
		label: runStatusLabel("waiting"),
		icon: Hourglass,
		box: "border-status-waiting/40 bg-status-waiting/10",
		text: "text-status-waiting",
	},
	sleeping: {
		label: runStatusLabel("sleeping"),
		icon: Moon,
		box: "border-status-sleeping/40 bg-status-sleeping/10",
		text: "text-status-sleeping",
	},
	finished: {
		label: runStatusLabel("finished"),
		icon: CircleCheck,
		box: "border-status-finished/40 bg-status-finished/10",
		text: "text-status-finished",
	},
	stopped: {
		label: runStatusLabel("stopped"),
		icon: CircleStop,
		box: "border-status-stopped/40 bg-status-stopped/10",
		text: "text-status-stopped",
	},
	failed: {
		label: runStatusLabel("failed"),
		icon: CircleX,
		box: "border-status-failed/40 bg-status-failed/10",
		text: "text-status-failed",
	},
	interrupted: {
		label: runStatusLabel("interrupted"),
		icon: CircleAlert,
		box: "border-status-interrupted/40 bg-status-interrupted/10",
		text: "text-status-interrupted",
	},
};

/** A step's state, in the colors of the run statuses. */
const STEP: Record<StepState, Look> = {
	running: RUN.running,
	waiting: RUN.waiting,
	failed: RUN.failed,
	stopped: RUN.stopped,
	done: { ...RUN.finished, label: "Done" },
};

function StatusBadge({ look, label }: { look: Look; label?: string }) {
	return (
		<Badge variant="outline" className={look.box}>
			<Icon as={look.icon} className={cn("size-3", look.text)} />
			<Text className={look.text}>{label ?? look.label}</Text>
		</Badge>
	);
}

/** The status of a run, with its icon and color. */
export function RunStatusBadge({ status }: { status: RunStatus }) {
	return <StatusBadge look={RUN[status]} />;
}

/** The state of a step. A done step shows the outcome it ended on. */
export function StepStateBadge({
	state,
	outcome,
}: {
	state: StepState;
	outcome: string | null;
}) {
	return (
		<StatusBadge
			look={STEP[state]}
			label={state === "done" && outcome ? outcome : undefined}
		/>
	);
}
