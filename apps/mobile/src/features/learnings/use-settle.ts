import { createKnowledgeQueries } from "@nightshift/client";
import {
	type Mutation,
	useMutation,
	useMutationState,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { useHostQueries } from "@/features/host";
import { type Learning, learningKey } from "./waiting";

/** What did not work, for an Alert above the list. */
export type SettleFailure = { title: string; message: string };

type Settle = { projectId: string; id: string };

/** The learning a keep or a delete is for, while it is on its way or once it worked. */
function settledKey(
	mutation: Mutation<unknown, Error, unknown>,
): string | null {
	const { status, variables } = mutation.state;
	if (status !== "pending" && status !== "success") return null;
	return variables ? learningKey(variables as Settle) : null;
}

/**
 * Keep and Delete of the learnings that wait. `settled` holds each
 * learning you keep or delete, from the tap on: the list leaves it out at
 * once, and it stays out until the list reads again without it. A keep or
 * delete that fails brings it back, and `failure` says why. Both read the
 * mutations' variables, also of a tap on a screen that is closed now.
 */
export function useSettleLearnings() {
	const knowledge = useHostQueries(createKnowledgeQueries);
	const queryClient = useQueryClient();
	const [failure, setFailure] = useState<SettleFailure | null>(null);
	const keepOptions = useMemo(() => knowledge.keep(), [knowledge]);
	const deleteOptions = useMemo(() => knowledge.delete(), [knowledge]);

	const readAgain = () =>
		Promise.all(
			[knowledge.learningsKey(), knowledge.getKey()].map((queryKey) =>
				queryClient.invalidateQueries({ queryKey }),
			),
		);
	const keep = useMutation({
		...keepOptions,
		onMutate: () => setFailure(null),
		onError: (error) =>
			setFailure({
				title: "The learning was not kept",
				message: error.message,
			}),
		onSettled: readAgain,
	});
	const remove = useMutation({
		...deleteOptions,
		onMutate: () => setFailure(null),
		onError: (error) =>
			setFailure({
				title: "The learning was not deleted",
				message: error.message,
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
	const settled = useMemo(() => new Set(settledList), [settledId]);

	const keepMutate = keep.mutate;
	const removeMutate = remove.mutate;
	const onKeep = useCallback(
		(learning: Learning) =>
			keepMutate({ projectId: learning.projectId, id: learning.id }),
		[keepMutate],
	);
	const onDelete = useCallback(
		(learning: Learning) =>
			removeMutate({ projectId: learning.projectId, id: learning.id }),
		[removeMutate],
	);

	return { settled, failure, onKeep, onDelete };
}
