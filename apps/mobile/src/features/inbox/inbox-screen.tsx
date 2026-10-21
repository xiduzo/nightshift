import { gateParts, type OpenGate, waitedText } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Badge } from "@nightshift/ui-native/components/ui/badge";
import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Skeleton } from "@nightshift/ui-native/components/ui/skeleton";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { router } from "expo-router";
import { CircleAlert, CircleCheck, Inbox } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { EmptyState } from "@/shared/empty";
import { Screen } from "@/shared/page";
import { useAnswered } from "./answered";
import { useInbox } from "./use-inbox";
import { useNow } from "./use-now";

/** The Needs-you inbox: the open Gates of every Space you are in, oldest first. */
export function InboxScreen() {
	const inbox = useInbox();
	const answered = useAnswered();
	const now = useNow();

	return (
		<Screen onRefresh={() => inbox.refetch()}>
			{answered ? (
				<Alert icon={CircleCheck}>
					<AlertTitle>Answered {answered.choice}</AlertTitle>
					<AlertDescription>
						{answered.runTitle}: the run goes on.
					</AlertDescription>
				</Alert>
			) : null}
			{inbox.data ? (
				inbox.data.length === 0 ? (
					<EmptyState
						icon={Inbox}
						title="Nothing needs you"
						description="When a run waits for your answer at a Gate, it shows up here. This inbox holds the Gates of every Space you are in."
					/>
				) : (
					inbox.data.map((gate) => (
						<GateRow
							key={`${gate.runId}:${gate.stepId}`}
							gate={gate}
							now={now}
						/>
					))
				)
			) : inbox.error ? (
				<Alert icon={CircleAlert} variant="destructive">
					<AlertTitle>The inbox did not load</AlertTitle>
					<AlertDescription>
						Check that this phone is online. Then pull down or try again.
					</AlertDescription>
					<Button
						variant="outline"
						size="sm"
						className="mt-2 self-start"
						onPress={() => void inbox.refetch()}
					>
						<Text>Try again</Text>
					</Button>
				</Alert>
			) : (
				<>
					<Skeleton className="h-28 w-full" />
					<Skeleton className="h-28 w-full" />
					<Skeleton className="h-28 w-full" />
				</>
			)}
		</Screen>
	);
}

/** One Gate: its question, its run, its Space and how long it has waited. Opens the answer sheet. */
function GateRow({ gate, now }: { gate: OpenGate; now: number }) {
	const { headline } = gateParts(gate.question);
	const waited = waitedText(now - gate.openedAt);
	return (
		<Pressable
			onPress={() =>
				router.push({
					pathname: "/gates/[runId]/[stepId]",
					params: { runId: gate.runId, stepId: gate.stepId },
				})
			}
			accessibilityRole="button"
			accessibilityHint="Opens the Gate to answer it"
			className="active:opacity-70"
		>
			<Card className="gap-3 py-4">
				<CardHeader className="gap-2 px-4">
					<View className="flex-row items-center justify-between gap-2">
						<Badge variant="secondary" className="max-w-[60%]">
							<Text numberOfLines={1}>{gate.spaceName}</Text>
						</Badge>
						<Text variant="muted" className="text-muted-foreground text-xs">
							Waiting {waited}
						</Text>
					</View>
					<CardTitle numberOfLines={3} className="leading-snug">
						{headline}
					</CardTitle>
					<CardDescription numberOfLines={2}>
						{gate.projectName} · {gate.runTitle}
					</CardDescription>
					{gate.canAnswer ? null : (
						<Text variant="muted" className="text-muted-foreground text-xs">
							You can read this Gate. Your role in this Space does not let you
							answer it.
						</Text>
					)}
				</CardHeader>
			</Card>
		</Pressable>
	);
}
