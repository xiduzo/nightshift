import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { spaceMutations } from "./queries";
import { useSpaceChanged } from "./space-tabs";

/**
 * Makes another of your Spaces the one you work in, then loads every query
 * again for it. For a page that leads into another Space (a Space a Host
 * keeps opens its Devices page there).
 */
export function useSwitchSpace() {
	const spaceChanged = useSpaceChanged();
	return useMutation(
		spaceMutations.switch({
			onSuccess: () => spaceChanged(),
			onError: (error) => {
				toast.error(`Could not switch the Space. ${error.message}`);
			},
		}),
	);
}
