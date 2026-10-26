import { gateParts, type OpenGate, plainText } from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Card } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { router } from "expo-router";
import { ArrowRight, CircleCheck } from "lucide-react-native";
import { View } from "react-native";

import { TONE_CLASS } from "@/shared/tone";
import type { SentAnswer } from "./use-gate-answer";

/**
 * The answer went: what you chose, what the run does now, your note, and
 * the way on: the next Gate that waits for you, or back to the inbox.
 */
export function SentCard({
	answer,
	outcome,
	next,
}: {
	answer: SentAnswer;
	/** "Fix the bug goes on at Build." */
	outcome: string;
	/** The next Gate in inbox order, or null when nothing else waits. */
	next: OpenGate | null;
}) {
	const nextHeadline = next
		? plainText(gateParts(next.question).headline)
		: null;
	return (
		<Card className="gap-3 px-4 py-5">
			<Icon as={CircleCheck} className={`size-8 ${TONE_CLASS.finished.text}`} />
			<View accessible className="gap-1">
				<Text
					accessibilityRole="header"
					className="font-semibold text-xl tracking-tight"
				>
					Sent
				</Text>
				<Text className="text-muted-foreground text-xs">Your answer</Text>
				<Text className="font-semibold text-base">{answer.choice}</Text>
				<Text selectable>{outcome}</Text>
			</View>
			{answer.note ? (
				<View accessible className="gap-1">
					<Text className="text-muted-foreground text-xs">Your note</Text>
					<Text selectable className="text-sm">
						{answer.note}
					</Text>
				</View>
			) : null}
			<View className="mt-2 gap-2">
				{next ? (
					<>
						<Button
							size="lg"
							onPress={() =>
								router.replace({
									pathname: "/gates/[runId]/[stepId]",
									params: { runId: next.runId, stepId: next.stepId },
								})
							}
							accessibilityHint={`Opens ${nextHeadline}`}
							className="h-auto min-h-11 py-2"
						>
							<Text>Next Gate</Text>
							<Icon as={ArrowRight} className="text-primary-foreground" />
						</Button>
						<Text className="text-muted-foreground text-xs" numberOfLines={1}>
							Next: {nextHeadline}
						</Text>
					</>
				) : (
					<Text className="text-muted-foreground text-sm">
						Nothing else waits for you.
					</Text>
				)}
				<Button
					size="lg"
					variant="outline"
					onPress={() => router.dismissTo("/inbox")}
					className="h-auto min-h-11 py-2"
				>
					<Text>Back to Inbox</Text>
				</Button>
			</View>
		</Card>
	);
}
