import { formatCountdown, waitedText } from "@nightshift/client";
import { Text } from "@nightshift/ui-native/components/ui/text";

import { useClock } from "./use-clock";

/**
 * The time left until `until`, again each second: "4:05", "1:02:09". Only
 * this text re-renders. A screen reader hears it in words: "4 min left".
 */
export function Countdown({
	until,
	className,
}: {
	until: number;
	className?: string;
}) {
	const now = useClock(1000);
	const left = until - now;
	return (
		<Text
			className={className}
			accessibilityRole="timer"
			accessibilityLabel={`${waitedText(left)} left`}
		>
			{formatCountdown(left)}
		</Text>
	);
}
