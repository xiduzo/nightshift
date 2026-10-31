import { Button } from "@nightshift/ui-native/components/ui/button";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Platform, View } from "react-native";

import { useLockScreenFollow } from "./use-lock-screen";

/** What following shows, on this phone. */
const FOLLOW_HINT =
	Platform.OS === "android"
		? "Shows the step and status of this run in a notification until it ends."
		: "Shows the step and status of this run on your lock screen until it ends.";

/**
 * "Follow on the lock screen" for a run on its way, or "Stop following":
 * a full-width outline button with a hint under it. Nothing on a phone
 * that cannot show it, or once the run has ended.
 */
export function FollowOnLockScreen({
	runId,
	ended,
}: {
	runId: string;
	ended: boolean;
}) {
	const { available, following, busy, problem, follow, unfollow } =
		useLockScreenFollow(runId);
	if (!available || ended) return null;

	return (
		<View className="gap-2">
			<Button
				size="lg"
				variant="outline"
				disabled={busy}
				onPress={() => void (following ? unfollow() : follow())}
				className="h-auto min-h-11 py-2"
			>
				<Text>
					{following
						? "Stop following on the lock screen"
						: busy
							? "Follow on the lock screen…"
							: "Follow on the lock screen"}
				</Text>
			</Button>
			<Text className="text-muted-foreground text-sm">
				{problem ??
					(following ? "You follow this run on the lock screen." : FOLLOW_HINT)}
			</Text>
		</View>
	);
}
