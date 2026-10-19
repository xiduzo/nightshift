import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { outcomeLabel } from "@/components/outcome-badge";
import { orpc } from "@/utils/orpc";

/**
 * Answers an open Gate. On success it toasts, takes the Gate out of the
 * inbox at once, and refetches Gates and runs to confirm.
 */
export function useResolveGate({ runTitle }: { runTitle?: string } = {}) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.gates.resolve.mutationOptions({
			onSuccess: (_, input) => {
				toast.success(
					`Answered ${outcomeLabel(input.choice)}${runTitle ? ` · ${runTitle}` : ""}`,
					{ description: "The run goes on." },
				);
				// Out of the inbox at once; the refetch confirms it.
				queryClient.setQueryData(orpc.gates.list.queryKey(), (gates) =>
					gates?.filter((gate) => gate.stepId !== input.stepId),
				);
				void queryClient.invalidateQueries({ queryKey: orpc.gates.key() });
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			},
			onError: (error) => toast.error(`Could not answer: ${error.message}`),
		}),
	);
}
