import { spaceChanged } from "@nightshift/client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert } from "react-native";

import { useSignedIn } from "@/features/host";
import { saveSpaceChoice } from "./space-choice";

/**
 * Makes another of your Spaces the one this phone works in, remembers it
 * for this Host, then forgets what the cache holds of the Space before and
 * reads the new one (`spaceChanged`).
 */
export function useSwitchSpace() {
	const { host } = useSignedIn();
	const queryClient = useQueryClient();
	return useMutation(
		host.orpc.spaces.switch.mutationOptions({
			onSuccess: async (_done, { spaceId }) => {
				await saveSpaceChoice(host.address, spaceId).catch(() => undefined);
				await spaceChanged(queryClient);
			},
			onError: (error) => {
				Alert.alert("Could not switch the Space", error.message);
			},
		}),
	);
}
