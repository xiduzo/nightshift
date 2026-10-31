import type { StoppedNotice, StoppedTone } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import {
	CircleAlert,
	CircleDashed,
	CircleStop,
	CircleX,
	Flag,
	type LucideIcon,
} from "lucide-react-native";

import { TONE_CLASS, type Tone } from "@/shared/tone";

const LOOK: Record<StoppedTone, { icon: LucideIcon; tone: Tone }> = {
	done: { icon: Flag, tone: "finished" },
	"nothing-to-do": { icon: CircleDashed, tone: "neutral" },
	"ended-failed": { icon: Flag, tone: "failed" },
	failed: { icon: CircleX, tone: "failed" },
	interrupted: { icon: CircleAlert, tone: "interrupted" },
	stopped: { icon: CircleStop, tone: "stopped" },
};

/**
 * Why a run ended and what you can do now, as the desktop says it
 * (`stoppedNotice`): "The run stopped. Resume it to continue."
 */
export function RunNotice({ notice }: { notice: StoppedNotice }) {
	const { icon, tone } = LOOK[notice.tone];
	return (
		<Alert icon={icon} iconClassName={TONE_CLASS[tone].text}>
			<AlertTitle>{notice.title}</AlertTitle>
			<AlertDescription numberOfLines={8}>
				{notice.body.trim()}
			</AlertDescription>
		</Alert>
	);
}
