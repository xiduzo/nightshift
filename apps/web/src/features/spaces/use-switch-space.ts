import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { spaceMutations } from "./queries";

/**
 * Makes another of your Spaces the one you work in, then loads every query
 * again for it. For a page that leads into another Space (an inbox Gate of
 * that Space opens its run there).
 */
export function useSwitchSpace() {
	const queryClient = useQueryClient();
	return useMutation(
		spaceMutations.switch({
			onSuccess: () => queryClient.invalidateQueries(),
			onError: (error) => {
				toast.error(`Could not switch the Space. ${error.message}`);
			},
		}),
	);
}
