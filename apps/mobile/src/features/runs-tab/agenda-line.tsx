import { formatTime, type RunStatus } from "@nightshift/client";
import {
	CircleAlert,
	CircleDot,
	CirclePause,
	Clock,
	Moon,
	RotateCcw,
} from "lucide-react-native";

import {
	NativeButtonRow,
	type NativeIcon,
	NativeRow,
	NativeTextRow,
	type RowAction,
} from "@/shared/native-list";
import { useThemeColors } from "@/shared/theme";
import type { Rail } from "./agenda";

const ICON = {
	running: { sf: "circle.dotted.circle", lucide: CircleDot },
	sleeping: { sf: "moon.fill", lucide: Moon },
	offline: { sf: "exclamationmark.triangle.fill", lucide: CircleAlert },
	paused: { sf: "pause.circle", lucide: CirclePause },
	quiet: { sf: "clock", lucide: Clock },
	problem: { sf: "exclamationmark.circle.fill", lucide: CircleAlert },
	retry: { sf: "arrow.clockwise", lucide: RotateCcw },
} as const satisfies Record<string, NativeIcon>;

type Colors = ReturnType<typeof useThemeColors>["colors"];

/** The icon of a line and its color: what it is at a glance. */
function look(
	rail: Rail,
	status: RunStatus | null,
	muted: boolean,
	colors: Colors,
): { icon: NativeIcon; color: string } {
	if (rail === "running") {
		return status === "sleeping"
			? { icon: ICON.sleeping, color: colors.statusSleeping }
			: { icon: ICON.running, color: colors.statusRunning };
	}
	if (rail === "offline") {
		return { icon: ICON.offline, color: colors.destructive };
	}
	return {
		icon: muted ? ICON.paused : ICON.quiet,
		color: colors.mutedForeground,
	};
}

/**
 * One line of the agenda as a native row: an icon in the color of what it
 * is, the title, one caption, and the time at the end. Its actions are
 * swipes on iOS and a long-press menu on Android.
 */
export function AgendaLine({
	at,
	title,
	caption,
	rail,
	status = null,
	muted = false,
	onPress,
	actions,
}: {
	at: number | null;
	title: string;
	caption: string;
	rail: Rail;
	/** The status of a run: a sleeping run has a moon. */
	status?: RunStatus | null;
	muted?: boolean;
	onPress?: () => void;
	actions?: readonly RowAction[];
}) {
	const { colors } = useThemeColors();
	const { icon, color } = look(rail, status, muted, colors);
	return (
		<NativeRow
			title={title}
			subtitle={caption}
			value={at === null ? undefined : formatTime(at)}
			icon={icon}
			iconColor={color}
			muted={muted}
			onPress={onPress}
			actions={actions}
		/>
	);
}

/** Why an action did not work, and how to fix it: a row under its line. */
export function ProblemLine({
	title,
	message,
	fix,
}: {
	title: string;
	/** The reason, often the Host's own message. */
	message: string;
	fix?: string;
}) {
	const { colors } = useThemeColors();
	return (
		<NativeTextRow
			text={title}
			note={fix ? `${message} ${fix}` : message}
			icon={ICON.problem}
			iconColor={colors.destructive}
		/>
	);
}

/**
 * A part of the agenda that did not load: what happened, and Try again.
 * Rows in an array, so a section on Android draws a divider between them.
 */
export function problemRows({
	title,
	message,
	onRetry,
}: {
	title: string;
	message: string;
	onRetry: () => void;
}) {
	return [
		<ProblemLine
			key="problem"
			title={title}
			message={message}
			fix="Check that this phone is online, then try again."
		/>,
		<NativeButtonRow
			key="retry"
			label="Try again"
			icon={ICON.retry}
			onPress={onRetry}
		/>,
	];
}
