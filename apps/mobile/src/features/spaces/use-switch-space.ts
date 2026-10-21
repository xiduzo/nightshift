import { createSpaceMutations } from "@nightshift/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";

import { useHostQueries, useSignedIn } from "@/features/host";
import { saveSpaceChoice } from "./space-choice";

/**
 * Makes another of your Spaces the one this phone works in, remembers it
 * for this Host, then loads every query again for it.
 */
export function useSwitchSpace() {
	const { host } = useSignedIn();
	const spaceMutations = useHostQueries(createSpaceMutations);
	const queryClient = useQueryClient();
	return useMutation(
		spaceMutations.switch({
			onSuccess: async (_done, { spaceId }) => {
				await saveSpaceChoice(host.address, spaceId).catch(() => undefined);
				await queryClient.invalidateQueries();
			},
			onError: (error) => {
				Alert.alert("Could not switch the Space", error.message);
			},
		}),
	);
}
