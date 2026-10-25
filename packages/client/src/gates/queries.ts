import type { UseMutationOptions } from "@tanstack/react-query";

import type { ApiQueryUtils } from "../api";
import { answerGate, type GateAnswer, type GateAnswerResult } from "./answer";

/** The query options of Gates. */
export function createGateQueries(orpc: ApiQueryUtils) {
	return {
		/** Every gates query. Invalidate it after a Gate is answered. */
		all: () => orpc.gates.key(),
		/**
		 * The open Gates of every Space the person is in, oldest first, each
		 * with its Space and whether they may answer it: the Needs-you inbox.
		 * It does not change with the active Space. The live cache reads it
		 * again on each item of the notifications stream, and once a minute
		 * while that stream is down. Refetches when the window gets focus. A
		 * failed read does not toast; the inbox shows the error itself.
		 */
		open: () => ({
			...orpc.gates.list.queryOptions(),
			refetchOnWindowFocus: "always" as const,
			meta: { quietErrors: true },
		}),
	};
}

type AnswerOptions = UseMutationOptions<GateAnswerResult, Error, GateAnswer>;

/**
 * The mutation options of Gates. `answer` answers a Gate in any of the
 * person's Spaces, bound to its `runId` and `stepId`; the active Space
 * stays. It resolves with what came of the answer: a refusal is a result
 * (`answerGate`), and only an answer that was not sent fails.
 */
export function createGateMutations(orpc: ApiQueryUtils) {
	return {
		answer: (
			options: Omit<AnswerOptions, "mutationKey" | "mutationFn"> = {},
		): AnswerOptions => ({
			...options,
			mutationKey: orpc.gates.resolve.mutationKey(),
			mutationFn: (input) =>
				answerGate({ gates: { resolve: orpc.gates.resolve.call } }, input),
		}),
	};
}
