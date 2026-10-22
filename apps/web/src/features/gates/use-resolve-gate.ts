import {
	gateRefusalText,
	unreachableAnswerText,
	useLiveCache,
} from "@nightshift/client";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { outcomeLabel } from "@/features/flows";
import { orpc } from "@/shared/api";
import { gateMutations } from "./queries";

/**
 * Answers an open Gate, in whichever of your Spaces it is: the Space you
 * work in stays as it is. An answer that went toasts. An answer to a Gate
 * that closed, or that is not in your Spaces, says so. Either way the Gate
 * leaves the inbox at once (`afterGateAnswered`).
 * A role that does not allow an answer, an answer the Host of the Space
 * cannot take now, or an answer that was not sent, toasts an error and
 * keeps the Gate.
 */
export function useResolveGate({
	runTitle,
	walkerName,
}: {
	runTitle?: string;
	/** The device that runs the run, when it is not this computer: the answer goes to it. */
	walkerName?: string;
} = {}) {
	const live = useLiveCache(orpc);

	return useMutation(
		gateMutations.answer({
			onSuccess: (result, input) => {
				if (result.kind === "refused") {
					const { title, description } = gateRefusalText(result.refusal);
					if (result.refusal === "closed" || result.refusal === "not-found") {
						toast(title, { description });
						live.afterGateAnswered(input);
					} else {
						toast.error(title, { description });
					}
					return;
				}
				toast.success(
					`Answered ${outcomeLabel(input.choice)}${runTitle ? ` · ${runTitle}` : ""}`,
					{
						description: walkerName
							? `Sent to ${walkerName}. The run goes on when ${walkerName} is online.`
							: "The run goes on.",
					},
				);
				live.afterGateAnswered(input);
			},
			onError: (error) => {
				const unreachable = unreachableAnswerText(error);
				if (unreachable) {
					toast.error(unreachable.title, {
						description: unreachable.description,
					});
					return;
				}
				toast.error("Your answer was not sent", { description: error.message });
			},
		}),
	);
}
