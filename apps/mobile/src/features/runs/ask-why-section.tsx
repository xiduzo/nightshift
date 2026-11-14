import {
	askWhyAnswer,
	askWhyMutation,
	explainRun,
	isMissingOnHost,
	type RunStatus,
} from "@nightshift/client";
import { useMutation, useMutationState, useQuery } from "@tanstack/react-query";
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
	NativePickerRow,
	NativeRow,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";
import { useThemeColors } from "@/shared/theme";
import {
	answerOptions,
	askWhyPick,
	DEFAULT,
	EFFORT_OPTIONS,
	takesEffort,
} from "./ask-why-pick";

/** The last ask about one run, as the mutation cache keeps it. */
type LastAsk = {
	status: "idle" | "pending" | "success" | "error";
	answer: string | undefined;
	error: Error | null;
};

/**
 * "Ask why" for a run that ended early: a section with one button row,
 * and above it who answers: the Explainer's default on the Host, or
 * another agent or model of the Host with an effort, for this ask. Its
 * one answer, about what went wrong and what you can do, shows in its
 * place. No thread: "Ask again" asks anew. The answer stays in the
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
	const [answer, setAnswer] = useState(DEFAULT);
	const [effort, setEffort] = useState(DEFAULT);
	const pickers = useAnswerPickers();
	const options = askWhyMutation(host.client, runId);
	const ask = useMutation({
		...options,
		mutationFn: () => {
			setActivity(null);
			return explainRun(host.client, runId, {
				onActivity: setActivity,
				pick: askWhyPick(answer, effort, pickers.status),
			});
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
	// Only an owner of the Host gets its lists: anyone else asks with the default.
	const choose =
		pickers.answers.length > 1 ? (
			<>
				<NativePickerRow
					title="Answers with"
					value={answer}
					options={pickers.answers}
					onChange={setAnswer}
				/>
				{takesEffort(answer, pickers.status) ? (
					<NativePickerRow
						title="Effort"
						value={effort}
						options={EFFORT_OPTIONS}
						onChange={setEffort}
					/>
				) : null}
			</>
		) : null;

	if (!last || last.status === "idle") {
		return (
			<NativeSection footer="An agent reads the run and tells you what went wrong.">
				{choose}
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
			{choose}
			<NativeButtonRow
				label="Ask again"
				icon={{ sf: "arrow.counterclockwise", lucide: RotateCcw }}
				onPress={asked}
			/>
		</NativeSection>
	);
}

/**
 * Who can answer "Ask why" on the Host: the Explainer's default, and the
 * Host's agents, models and deciders. Empty lists when the Host does not
 * give them, to a Person who does not own it.
 */
function useAnswerPickers() {
	const { host } = useSignedIn();
	const quiet = {
		staleTime: 60_000,
		retry: false,
		meta: { quietErrors: true },
	} as const;
	const agents = useQuery({
		...host.orpc.assistant.agents.queryOptions(),
		...quiet,
	});
	const profiles = useQuery({
		...host.orpc.profiles.list.queryOptions(),
		...quiet,
	});
	const deciders = useQuery({
		...host.orpc.deciders.list.queryOptions(),
		...quiet,
	});
	const status = agents.data?.find((agent) => agent.id === "explainer");
	return {
		status,
		answers:
			profiles.data === undefined
				? []
				: answerOptions(status, profiles.data, deciders.data ?? []),
	};
}
