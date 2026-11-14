import { gateParts, type OpenGate, plainText } from "@nightshift/client";
import { router } from "expo-router";
import { ArrowRight, CircleCheck } from "lucide-react-native";

import {
	NativeButtonRow,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";
import { useThemeColors } from "@/shared/theme";
import type { SentAnswer } from "./use-gate-answer";

/**
 * The answer went: what you chose, what the run does now, your note, and
 * the way on: the next Gate that waits for you, or back to Needs you.
 */
export function SentSection({
	answer,
	outcome,
	next,
}: {
	answer: SentAnswer;
	/** "Fix the bug continues at Build." */
	outcome: string;
	/** The next Gate in inbox order, or null when nothing else waits. */
	next: OpenGate | null;
}) {
	const { colors } = useThemeColors();
	const nextHeadline = next
		? plainText(gateParts(next.question).headline)
		: null;
	return (
		<>
			<NativeSection title="Sent">
				<NativeTextRow
					icon={{ sf: "checkmark.circle.fill", lucide: CircleCheck }}
					iconColor={colors.statusFinished}
					text={`**${answer.choice}**`}
					note={outcome}
				/>
				{answer.note ? (
					<NativeTextRow text={answer.note} note="Your note" />
				) : null}
			</NativeSection>
			<NativeSection
				footer={
					nextHeadline ? `Next: ${nextHeadline}` : "Nothing else waits for you."
				}
			>
				{next ? (
					<NativeButtonRow
						label="Next Gate"
						icon={{ sf: "arrow.right", lucide: ArrowRight }}
						onPress={() =>
							router.replace({
								pathname: "/gates/[runId]/[stepId]",
								params: { runId: next.runId, stepId: next.stepId },
							})
						}
					/>
				) : null}
				<NativeButtonRow
					label="Back to Needs you"
					onPress={() => router.dismissTo("/")}
				/>
			</NativeSection>
		</>
	);
}
