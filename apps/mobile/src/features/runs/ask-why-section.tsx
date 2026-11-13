import {
	askWhyAnswer,
	askWhyMutation,
	explainRun,
	isMissingOnHost,
	type RunStatus,
} from "@nightshift/client";
import { useMutation, useMutationState } from "@tanstack/react-query";
import {
	Hourglass,
	MessageCircleQuestion,
	RotateCcw,
	TriangleAlert,
} from "lucide-react-native";
import { memo, useState } from "react";

import { useSignedIn } from "@/features/host";
import {
	NativeButtonRow,
	NativeRow,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";
import { useThemeColors } from "@/shared/theme";

/** The last ask about one run, as the mutation cache keeps it. */
type LastAsk = {
	status: "idle" | "pending" | "success" | "error";
	answer: string | undefined;
	error: Error | null;
};

/**
 * "Ask why" for a run that ended early: a section with one button row.
 * Its one answer, about what went wrong and what you can do, shows in
 * its place. No thread: "Ask again" asks anew. The answer stays in the
 * mutation cache, so it shows again when the run opens again. Nothing for
 * a run that finished, and nothing on a Host of an older version, which
 * does not have it.
 */
export const AskWhySection = memo(function AskWhySection({
	runId,
	status,
}: {
	runId: string;
	status: RunStatus;
}) {
	if (!askWhyAnswer(status)) return null;
	return <AskWhy runId={runId} failed={status === "failed"} />;
});

function AskWhy({ runId, failed }: { runId: string; failed: boolean }) {
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
	const asked = () => ask.mutate();
	const title = failed ? "Why it failed" : "Why it stopped";

	if (!last || last.status === "idle") {
		return (
			<NativeSection footer="An agent reads the run and tells you what went wrong.">
				<NativeButtonRow
					label="Ask why"
					icon={{ sf: "questionmark.bubble", lucide: MessageCircleQuestion }}
					onPress={asked}
				/>
			</NativeSection>
		);
	}

	if (last.status === "pending") {
		return (
			<NativeSection title={title}>
				<NativeRow
					icon={{ sf: "hourglass", lucide: Hourglass }}
					iconColor={colors.mutedForeground}
					title="The agent reads the run."
					subtitle={activity ?? "This can take a minute."}
				/>
			</NativeSection>
		);
	}

	return (
		<NativeSection title={title}>
			{last.status === "success" && last.answer ? (
				<NativeTextRow text={last.answer} selectable />
			) : (
				<NativeRow
					icon={{ sf: "exclamationmark.triangle.fill", lucide: TriangleAlert }}
					iconColor={colors.destructive}
					title="No answer came"
					subtitle={last.error?.message || undefined}
				/>
			)}
			<NativeButtonRow
				label="Ask again"
				icon={{ sf: "arrow.counterclockwise", lucide: RotateCcw }}
				onPress={asked}
			/>
		</NativeSection>
	);
}
