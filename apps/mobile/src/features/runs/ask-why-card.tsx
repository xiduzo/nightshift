import {
	askWhyAnswer,
	askWhyMutation,
	explainRun,
	isMissingOnHost,
	type RunStatus,
} from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Card, CardContent } from "@nightshift/ui-native/components/ui/card";
import { Icon } from "@nightshift/ui-native/components/ui/icon";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { useMutation, useMutationState } from "@tanstack/react-query";
import { MessageCircleQuestion, RotateCcw } from "lucide-react-native";
import { memo, useState } from "react";
import { ActivityIndicator, View } from "react-native";

import { useSignedIn } from "@/features/host";
import { ErrorAlert } from "@/shared/feedback";
import { SectionHead } from "@/shared/list";
import { useThemeColors } from "@/shared/theme";

/** The last ask about one run, as the mutation cache keeps it. */
type LastAsk = {
	status: "idle" | "pending" | "success" | "error";
	answer: string | undefined;
	error: Error | null;
};

/**
 * "Ask why" for a run that ended early: one answer from an agent, about
 * what went wrong and what you can do. No thread: "Ask again" asks anew.
 * The answer stays in the mutation cache, so it shows again when the run
 * opens again. Nothing for a run that finished, and nothing on a Host of
 * an older version, which does not have it.
 */
export const AskWhyCard = memo(function AskWhyCard({
	runId,
	status,
}: {
	runId: string;
	status: RunStatus;
}) {
	if (!askWhyAnswer(status)) return null;
	return <AskWhy runId={runId} />;
});

function AskWhy({ runId }: { runId: string }) {
	const { host } = useSignedIn();
	const { colors } = useThemeColors();
	const [activity, setActivity] = useState<string | null>(null);
	const options = askWhyMutation(host.client, runId);
	const ask = useMutation({
		...options,
		mutationFn: () => {
			setActivity(null);
			return explainRun(host.client, runId, { onActivity: setActivity });
		},
	});
	// Every ask about this run, also one from before the screen opened again.
	const asks = useMutationState({
		filters: { mutationKey: options.mutationKey },
		select: (mutation): LastAsk => ({
			status: mutation.state.status,
			answer: mutation.state.data as string | undefined,
			error: mutation.state.error,
		}),
	});
	const last = asks.at(-1);
	if (last?.error && isMissingOnHost(last.error)) return null;
	const asking = last?.status === "pending";
	const asked = () => ask.mutate();

	return (
		<View className="gap-3">
			<SectionHead title="Ask why" />
			<Card className="py-4">
				<CardContent className="gap-3 px-4">
					{asking ? (
						<View
							className="flex-row items-center gap-3"
							accessibilityLiveRegion="polite"
						>
							<ActivityIndicator color={colors.mutedForeground} />
							<View className="flex-1 gap-0.5">
								<Text>The agent reads the run.</Text>
								<Text
									numberOfLines={1}
									className="text-muted-foreground text-sm"
								>
									{activity ?? "This can take a minute."}
								</Text>
							</View>
						</View>
					) : last?.status === "success" && last.answer ? (
						<Text selectable>{last.answer}</Text>
					) : last?.status === "error" && last.error ? (
						<ErrorAlert title="No answer came" message={last.error.message} />
					) : (
						<Text className="text-muted-foreground">
							An agent reads the run and tells you what went wrong and what you
							can do.
						</Text>
					)}
					{asking ? null : last && last.status !== "idle" ? (
						<Button
							size="lg"
							variant="outline"
							className="h-auto min-h-11 self-start py-2"
							onPress={asked}
							accessibilityHint="Asks the agent about this run again"
						>
							<Icon as={RotateCcw} />
							<Text>Ask again</Text>
						</Button>
					) : (
						<Button
							size="lg"
							className="h-auto min-h-11 self-start py-2"
							onPress={asked}
							accessibilityHint="An agent reads the run and answers"
						>
							<Icon as={MessageCircleQuestion} />
							<Text>Ask why</Text>
						</Button>
					)}
				</CardContent>
			</Card>
		</View>
	);
}
