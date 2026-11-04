import {
	type Mutation,
	useMutation,
	useMutationState,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { ApiQueryUtils } from "../api";
import { learningKey } from "./learnings";
import { createKnowledgeQueries } from "./queries";

/** The learning a keep or a delete is for. */
type Settled = { projectId: string; id: string };

/** What did not work, in words for a person, and for which learning. */
export type SettleFailure = {
	title: string;
	message: string;
	learning: Settled;
};

/** A keep or a delete. */
export type SettleDecision = "keep" | "delete";

/** The learning a keep or a delete is for, while it is on its way or once it worked. */
function settledKey(
	mutation: Mutation<unknown, Error, unknown>,
): string | null {
	const { status, variables } = mutation.state;
	if (status !== "pending" && status !== "success") return null;
	return variables ? learningKey(variables as Settled) : null;
}

/**
 * Keep and Delete of the learnings that wait, for both apps, with what each
 * reads again. `settled` holds the key (`learningKey`) of each learning from
 * the moment it goes out: a list leaves it out at once (`stillWaiting`), and it
 * stays out until the list reads again without it, also when the screen that
 * sent it is closed by then. A keep or delete that fails comes back, and
 * `onFailed` says why.
 *
 * When a keep or a delete goes out is each app's own: the phone sends it at the
 * tap and asks first for a delete, the web app gives a few seconds to take it
 * back. A phone has no such moment to hold.
 */
export function useSettleLearnings(
	orpc: ApiQueryUtils,
	options: { onFailed?: (failure: SettleFailure) => void } = {},
) {
	const { onFailed } = options;
	const knowledge = useMemo(() => createKnowledgeQueries(orpc), [orpc]);
	const keepOptions = useMemo(() => knowledge.keep(), [knowledge]);
	const deleteOptions = useMemo(() => knowledge.delete(), [knowledge]);
	const queryClient = useQueryClient();

	const readAgain = () =>
		Promise.all(
			[knowledge.learningsKey(), knowledge.getKey(), knowledge.reviewKey()].map(
				(queryKey) => queryClient.invalidateQueries({ queryKey }),
			),
		);
	const keep = useMutation({
		...keepOptions,
		onError: (error, learning) =>
			onFailed?.({
				title: "The learning was not kept",
				message: error.message,
				learning,
			}),
		onSettled: readAgain,
	});
	const remove = useMutation({
		...deleteOptions,
		onError: (error, learning) =>
			onFailed?.({
				title: "The learning was not deleted",
				message: error.message,
				learning,
			}),
		onSettled: readAgain,
	});

	const kept = useMutationState({
		filters: { mutationKey: keepOptions.mutationKey },
		select: settledKey,
	});
	const deleted = useMutationState({
		filters: { mutationKey: deleteOptions.mutationKey },
		select: settledKey,
	});
	const settledList = [...kept, ...deleted].filter(
		(key): key is string => key !== null,
	);
	const settledId = settledList.join("\n");
	// biome-ignore lint/correctness/useExhaustiveDependencies: the joined keys say when the set changes.
	const settled: ReadonlySet<string> = useMemo(
		() => new Set(settledList),
		[settledId],
	);

	const keepMutate = keep.mutate;
	const removeMutate = remove.mutate;
	const settle = useCallback(
		(learning: Settled, decision: SettleDecision) => {
			const input = { projectId: learning.projectId, id: learning.id };
			if (decision === "keep") keepMutate(input);
			else removeMutate(input);
		},
		[keepMutate, removeMutate],
	);

	return { settled, settle };
}
