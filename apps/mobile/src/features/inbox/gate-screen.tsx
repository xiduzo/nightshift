import { gateRefusalText, type OpenGate } from "@nightshift/client";
import { Button } from "@nightshift/ui-native/components/ui/button";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { Redirect, router, useLocalSearchParams } from "expo-router";
import { CircleCheck } from "lucide-react-native";
import { useState } from "react";

import { useHost } from "@/features/host";
import { EmptyState } from "@/shared/empty";
import { ErrorAlert } from "@/shared/feedback";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";
import { GateBriefing } from "./gate-briefing";
import type { GoneRefusal } from "./use-gate-answer";
import { useInbox } from "./use-inbox";

/**
 * One open Gate, to answer it: `gates/<runId>/<stepId>`, also the link
 * that a notification opens. Signed out, the person signs in first.
 */
export function GateAnswerScreen() {
	const { state } = useHost();
	if (state.status === "loading") return <Screen>{null}</Screen>;
	if (state.status === "signed-out") return <Redirect href="/connect" />;
	return <GateAnswer />;
}

function GateAnswer() {
	const { runId, stepId } = useLocalSearchParams<{
		runId: string;
		stepId: string;
	}>();
	const inbox = useInbox(useWhileFocused().subscribed);
	/** Night Shift refused the answer: the Gate does not wait for you anymore. */
	const [gone, setGone] = useState<GoneRefusal | null>(null);
	/** The answer went: the screen keeps the Gate while the inbox drops it. */
	const [sent, setSent] = useState<OpenGate | null>(null);
	const gate =
		inbox.data?.find(
			(open) => open.runId === runId && open.stepId === stepId,
		) ?? sent;

	if (gone) return <ClosedGate {...gateRefusalText(gone)} />;
	if (gate) {
		return (
			<GateBriefing
				key={`${gate.runId}:${gate.stepId}`}
				gate={gate}
				inbox={inbox.data ?? []}
				onRefresh={() => inbox.refetch()}
				onSent={() => setSent(gate)}
				onGone={setGone}
			/>
		);
	}
	if (inbox.data) {
		return (
			<ClosedGate
				title="This Gate does not wait anymore"
				description="Someone answered it, or its run ended."
			/>
		);
	}
	return (
		<Screen onRefresh={() => inbox.refetch()}>
			{inbox.error ? (
				<ErrorAlert
					title="The Gate did not load"
					message="Check that this phone is online. Then try again."
					onRetry={() => void inbox.refetch()}
				/>
			) : (
				<>
					<Skeleton className="h-5 w-1/2" />
					<Skeleton className="h-16 w-full" />
					<Skeleton className="h-8 w-2/3 rounded-full" />
					<Skeleton className="h-32 w-full rounded-xl" />
					<Skeleton className="h-24 w-full rounded-xl" />
				</>
			)}
		</Screen>
	);
}

function ClosedGate({
	title,
	description,
}: {
	title: string;
	description: string;
}) {
	return (
		<Screen>
			<EmptyState icon={CircleCheck} title={title} description={description}>
				<Button
					size="lg"
					onPress={() => router.dismissTo("/")}
					className="h-auto min-h-11 py-2"
				>
					<Text>Back to Needs you</Text>
				</Button>
			</EmptyState>
		</Screen>
	);
}
