import { createRunQueries } from "@nightshift/client";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { Share } from "react-native";

import { useHostQueries } from "@/features/host";

/**
 * Opens the share sheet with the command that takes a run over by hand.
 * Once you share it, Night Shift notes that you took the run over: Needed
 * you counts it. Nothing waits for that note, and a refusal stays quiet:
 * an older Host does not know it. Without a command, it does nothing.
 */
export function useShareTakeOver(
	runId: string,
	command: string | null,
): () => void {
	const runQueries = useHostQueries(createRunQueries);
	const { mutate } = useMutation(runQueries.takeOver());
	return useCallback(() => {
		if (!command) return;
		void Share.share({ message: command }).then((result) => {
			if (result.action === Share.sharedAction) mutate({ runId });
		});
	}, [command, mutate, runId]);
}
