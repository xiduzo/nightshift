import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { outcomeLabel } from "@/features/flows";
import { runQueries } from "@/features/runs/queries";
import { gateMutations, gateQueries } from "./queries";

/**
 * Answers an open Gate, in whichever of your Spaces it is: the Space you
 * work in stays as it is. On success it toasts, takes the Gate out of the
 * inbox at once, and refetches Gates and runs to confirm.
 */
export function useResolveGate({
	runTitle,
	walkerName,
}: {
	runTitle?: string;
	/** The device that runs the run, when it is not this computer: the answer goes to it. */
	walkerName?: string;
} = {}) {
	const queryClient = useQueryClient();
	return useMutation(
		gateMutations.resolve({
			onSuccess: (_, input) => {
				toast.success(
					`Answered ${outcomeLabel(input.choice)}${runTitle ? ` · ${runTitle}` : ""}`,
					{
						description: walkerName
							? `Sent to ${walkerName}. The run goes on when ${walkerName} is online.`
							: "The run goes on.",
					},
				);
				// Out of the inbox at once; the refetch confirms it.
				queryClient.setQueryData(gateQueries.open().queryKey, (gates) =>
					gates?.filter(
						(gate) =>
							gate.runId !== input.runId || gate.stepId !== input.stepId,
					),
				);
				void queryClient.invalidateQueries({ queryKey: gateQueries.all() });
				void queryClient.invalidateQueries({ queryKey: runQueries.all() });
			},
			onError: (error) => toast.error(`Could not answer: ${error.message}`),
		}),
	);
}
