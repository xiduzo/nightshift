import type { THEME, ThemeName } from "@nightshift/ui-native/lib/theme";
import type { NativeIcon } from "@/shared/native-list";
import { iconOf } from "@/shared/status";
import type {
	Look,
	StatusIconName,
	StepKindIconName,
	Tone,
} from "@/shared/tone";

/**
 * A status as the native list draws it: an SF Symbol on iOS and the same
 * lucide icon as before on Android, in the tone's color as a value (the
 * native rows take a color, not a class).
 */

type Colors = (typeof THEME)[ThemeName];

const SF: Record<StatusIconName | StepKindIconName, NativeIcon["sf"]> = {
	loader: "arrow.triangle.2.circlepath",
	hourglass: "hourglass",
	moon: "moon.zzz",
	"circle-check": "checkmark.circle.fill",
	"circle-stop": "stop.circle",
	"circle-x": "xmark.circle.fill",
	"circle-alert": "exclamationmark.circle",
	"circle-dot": "smallcircle.filled.circle",
	"circle-dashed": "circle.dashed",
	"message-question": "questionmark.bubble",
	"triangle-alert": "exclamationmark.triangle.fill",
	hand: "hand.raised.fill",
	bot: "sparkles",
	terminal: "apple.terminal",
	split: "arrow.triangle.branch",
	function: "function",
	variable: "x.squareroot",
	plug: "powerplug",
	flag: "flag.checkered",
	merge: "arrow.triangle.merge",
	lock: "lock",
	server: "server.rack",
	diff: "plusminus",
	convert: "arrow.left.arrow.right",
	globe: "globe",
};

/** The icon of a status or a step kind, on both platforms. */
export function nativeIconOf(
	name: StatusIconName | StepKindIconName,
): NativeIcon {
	return { sf: SF[name], lucide: iconOf(name) };
}

/** The color of a tone, as a value of the theme. */
export function toneColor(tone: Tone, colors: Colors): string {
	switch (tone) {
		case "running":
			return colors.statusRunning;
		case "waiting":
		case "needs-input":
			return colors.statusWaiting;
		case "sleeping":
			return colors.statusSleeping;
		case "finished":
		case "pass":
			return colors.statusFinished;
		case "stopped":
			return colors.statusStopped;
		case "failed":
		case "fail":
			return colors.statusFailed;
		case "interrupted":
			return colors.statusInterrupted;
		case "label":
		case "neutral":
			return colors.mutedForeground;
	}
}

/** A look's icon and color, for a NativeRow. */
export function nativeLook(
	look: Look,
	colors: Colors,
): { icon: NativeIcon; iconColor: string } {
	return {
		icon: nativeIconOf(look.icon),
		iconColor: toneColor(look.tone, colors),
	};
}
