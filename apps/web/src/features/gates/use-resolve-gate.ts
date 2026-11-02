import {
	gateRefusalText,
	unreachableAnswerText,
	useAnswerGate,
} from "@nightshift/client";
import { toast } from "sonner";

import { outcomeLabel } from "@/features/flows";
import { orpc } from "@/shared/api";
import { webGateAnswer } from "./gate-via";

/**
 * Answers an open Gate, in whichever of your Spaces it is: the Space you
 * work in stays as it is. An answer that went toasts. An answer to a Gate
 * that closed, or that is not in your Spaces, says so. A role that does
 * not allow an answer, an answer the Host of the Space cannot take now, or
 * an answer that was not sent, toasts an error. Whether the Gate leaves
 * the inbox is the live cache's rule (`useAnswerGate`). Every answer from
 * the web app says it came from the web.
 */
export function useResolveGate({
	runTitle,
	walkerName,
}: {
	runTitle?: string;
	/** The device that runs the run, when it is not this computer: the answer goes to it. */
	walkerName?: string;
} = {}) {
	const resolve = useAnswerGate(
		{ orpc },
		{
			onSuccess: (result, input) => {
				if (result.kind === "refused") {
					const { title, description } = gateRefusalText(result.refusal);
					if (result.refusal === "closed" || result.refusal === "not-found") {
						toast(title, { description });
					} else {
						toast.error(title, { description });
					}
					return;
				}
				// An Ask's answer is its form, not a choice.
				const said =
					input.data === undefined
						? `Answered ${outcomeLabel(input.choice)}`
						: "Answer sent";
				toast.success(`${said}${runTitle ? ` · ${runTitle}` : ""}`, {
					description: walkerName
						? `Sent to ${walkerName}. The run continues when ${walkerName} is online.`
						: "The run continues.",
				});
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
		},
	);
	const mutate: typeof resolve.mutate = (input, options) =>
		resolve.mutate(webGateAnswer(input) as typeof input, options);
	const mutateAsync: typeof resolve.mutateAsync = (input, options) =>
		resolve.mutateAsync(webGateAnswer(input) as typeof input, options);
	return { ...resolve, mutate, mutateAsync };
}
