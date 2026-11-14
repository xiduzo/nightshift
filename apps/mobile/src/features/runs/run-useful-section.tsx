import {
	createRunQueries,
	knownUseful,
	type RunDetail,
	type RunStatus,
	rememberedUseful,
	rememberUseful,
	USEFUL_ERROR,
	USEFUL_HINT,
	USEFUL_QUESTION,
	usefulLabel,
	usefulView,
} from "@nightshift/client";
import { useMutation } from "@tanstack/react-query";
import { ThumbsDown, ThumbsUp } from "lucide-react-native";
import { useRef, useState } from "react";

import { useHostQueries } from "@/features/host";
import {
	NativeButtonRow,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";

/**
 * One tap on a finished run: was it useful? After it lands, the section
 * shows the choice and does not ask again. `status` is the one the screen
 * shows, an action on its way too. A test run does not ask.
 */
export function RunUsefulSection({
	run,
	status,
}: {
	run: RunDetail;
	status: RunStatus;
}) {
	const queries = useHostQueries(createRunQueries);
	const [sending, setSending] = useState<boolean | null>(null);
	const [failed, setFailed] = useState(false);
	// Read again after a save, so the choice shows at once.
	const [, setSaved] = useState(0);
	const busy = useRef(false);
	const mark = useMutation(queries.useful());
	const known = knownUseful(run.metrics?.scores, rememberedUseful(run.id));
	const view = usefulView(status, known, run);

	const choose = (useful: boolean) => {
		if (busy.current) return;
		busy.current = true;
		setFailed(false);
		setSending(useful);
		mark.mutate(
			{ runId: run.id, useful },
			{
				onSuccess: () => {
					rememberUseful(run.id, useful);
					busy.current = false;
					setSending(null);
					setSaved((n) => n + 1);
				},
				onError: () => {
					busy.current = false;
					setSending(null);
					setFailed(true);
				},
			},
		);
	};

	if (view === "hidden") return null;
	if (view !== "ask") {
		return (
			<NativeSection>
				<NativeTextRow text={usefulLabel(view)} secondary />
			</NativeSection>
		);
	}

	return (
		<NativeSection
			title={USEFUL_QUESTION}
			footer={failed ? USEFUL_ERROR : USEFUL_HINT}
		>
			<NativeButtonRow
				label={sending === true ? "Yes…" : "Yes"}
				icon={{ sf: "hand.thumbsup", lucide: ThumbsUp }}
				disabled={sending !== null}
				onPress={() => choose(true)}
			/>
			<NativeButtonRow
				label={sending === false ? "No…" : "No"}
				icon={{ sf: "hand.thumbsdown", lucide: ThumbsDown }}
				disabled={sending !== null}
				onPress={() => choose(false)}
			/>
		</NativeSection>
	);
}
