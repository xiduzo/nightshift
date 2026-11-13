import { Button } from "@nightshift/ui-native/components/ui/button";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Progress } from "@nightshift/ui-native/components/ui/progress";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { SkipForward } from "lucide-react-native";
import { View } from "react-native";

/**
 * Where you are in the queue: "2 of 5" with a Progress, and Skip, which
 * moves this thing to the end of the queue. No Skip when one thing waits.
 */
export function QueueBar({
	position,
	total,
	onSkip,
}: {
	position: number;
	total: number;
	onSkip: () => void;
}) {
	return (
		<View className="gap-2">
			<View className="flex-row items-center justify-between gap-2">
				<Text
					className="text-muted-foreground text-sm tabular-nums"
					accessibilityLabel={`${position} of ${total} things that wait for you`}
				>
					{`${position} of ${total}`}
				</Text>
				{total > 1 ? (
					<Button
						variant="ghost"
						size="sm"
						onPress={onSkip}
						className="h-auto min-h-11 py-2"
						accessibilityHint="Moves this to the end. You see it again later."
					>
						<Icon as={SkipForward} className="text-foreground" />
						<Text>Skip</Text>
					</Button>
				) : null}
			</View>
			<Progress
				value={(position / total) * 100}
				accessibilityElementsHidden
				importantForAccessibility="no-hide-descendants"
			/>
		</View>
	);
}
