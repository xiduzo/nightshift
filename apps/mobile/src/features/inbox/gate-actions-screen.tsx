import { createRunQueries } from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { CirclePlay, Share2, SquareTerminal } from "lucide-react-native";
import { Share } from "react-native";

import { useHostQueries } from "@/features/host";
import { ListGroup, ListRow } from "@/shared/list";
import { Screen } from "@/shared/page";
import { useWhileFocused } from "@/shared/refresh";

/**
 * The "More" sheet of a Gate: open its run, read the transcript, or share
 * the command that takes the run over on a computer.
 */
export function GateActionsScreen() {
	const { runId } = useLocalSearchParams<{ runId: string; stepId: string }>();
	const runQueries = useHostQueries(createRunQueries);
	const run = useQuery({ ...runQueries.get(runId), ...useWhileFocused() });
	const command = run.data?.takeOverCommand ?? null;

	return (
		<Screen summary={run.data?.title}>
			<ListGroup>
				<ListRow
					icon={CirclePlay}
					title="Open the run"
					caption={run.data?.title}
					onPress={() => {
						router.dismiss();
						router.push({ pathname: "/runs/[runId]", params: { runId } });
					}}
				/>
				<ListRow
					icon={SquareTerminal}
					title="Transcript"
					caption="What the agents said and did"
					onPress={() =>
						router.replace({
							pathname: "/transcript/[runId]",
							params: { runId },
						})
					}
				/>
				{command ? (
					<ListRow
						icon={Share2}
						title="Share the take-over command"
						caption={[{ text: command, mono: true }]}
						detail="Run it in a terminal on your computer to continue by hand."
						chevron={false}
						onPress={() => void Share.share({ message: command })}
						accessibilityHint="Opens the share sheet with the command"
					/>
				) : null}
			</ListGroup>
		</Screen>
	);
}
