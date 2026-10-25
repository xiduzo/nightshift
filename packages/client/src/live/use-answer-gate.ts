import { type UseMutationOptions, useMutation } from "@tanstack/react-query";

import {
	createGateMutations,
	type GateAnswer,
	type GateAnswerResult,
} from "../gates";
import { type HostApi, useLiveCache } from "./use-live-cache";

type AnswerOptions = Omit<
	UseMutationOptions<GateAnswerResult, Error, GateAnswer>,
	"mutationKey" | "mutationFn"
>;

/**
 * Answers a Gate in any of the person's Spaces. A refusal is a result
 * (`answerGate`), so the screen says why; only an answer that was not sent
 * fails. After the screen's own `onSuccess`, the live cache applies the one
 * rule of both apps: an answer that went, or a refusal of "closed" or "not
 * found", takes the Gate out of the inbox at once and its notifications away.
 */
export function useAnswerGate(
	host: Pick<HostApi, "orpc">,
	options: AnswerOptions = {},
) {
	const live = useLiveCache(host.orpc);
	return useMutation(
		createGateMutations(host.orpc).answer({
			...options,
			onSuccess: (result, input, onMutateResult, context) => {
				const done = options.onSuccess?.(
					result,
					input,
					onMutateResult,
					context,
				);
				live.gateAnswered(input, result);
				return done;
			},
		}),
	);
}
