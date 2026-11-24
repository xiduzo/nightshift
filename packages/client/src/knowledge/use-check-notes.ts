import { messageOf } from "@nightshift/refusal";
import {
	type Mutation,
	useMutation,
	useMutationState,
	useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";

import type { ApiQueryUtils } from "../api";
import type { WaitingLearning } from "./learnings";
import { createKnowledgeQueries } from "./queries";

/**
 * One note of a learning that waits, as a screen asks a person about it:
 * its project, its step's file (`learningId`), its place in the file's
 * notes, its text, and the notes close to it.
 */
export type NoteToCheck = {
	projectId: string;
	learningId: string;
	index: number;
	note: string;
	/** The notes close to this one: compare them before you decide. */
	nearTo: NonNullable<WaitingLearning["nearTo"]>[number];
	/** The person's role lets them keep, delete or change it. */
	mayDecide: boolean;
	/** Epoch ms: when its step last added to the file. */
	proposedAt: number;
};

/** What did not work, in words for a person. `note`: the note it was about, if any. */
export type NoteFailure = {
	title: string;
	message: string;
	note: NoteToCheck | null;
};

/** What a keep, a delete or a change is about: its file and its text, not its place, which moves. */
function keyOf(note: {
	projectId: string;
	learningId: string;
	note: string;
}): string {
	return JSON.stringify([note.projectId, note.learningId, note.note]);
}

/**
 * The note a settle or a tell is about, by what it sent: the note it keeps
 * or deletes, or the note it replaces. Null for a tell of a new note.
 */
export function checkedNoteKey(input: {
	projectId: string;
	learningId?: string;
	note: string;
	replaces?: { learningId: string; note?: string };
}): string | null {
	if (input.learningId !== undefined) {
		return keyOf({ ...input, learningId: input.learningId });
	}
	const { replaces } = input;
	if (replaces?.note === undefined) return null;
	return keyOf({
		projectId: input.projectId,
		learningId: replaces.learningId,
		note: replaces.note,
	});
}

/** The note of a settle or a tell while it is on its way or once it worked. */
function checkedKey(
	mutation: Mutation<unknown, Error, unknown>,
): string | null {
	const { status, variables } = mutation.state;
	if ((status !== "pending" && status !== "success") || !variables) {
		return null;
	}
	return checkedNoteKey(variables as Parameters<typeof checkedNoteKey>[0]);
}

/**
 * The notes of the learnings, one each, in the order of the learnings and
 * of their notes, without those whose key (`checkedNoteKey`) is in `checked`.
 */
export function notesToCheck(
	learnings: readonly WaitingLearning[],
	checked: ReadonlySet<string>,
): NoteToCheck[] {
	return learnings.flatMap((learning) =>
		learning.notes.flatMap((note, index) => {
			const one: NoteToCheck = {
				projectId: learning.projectId,
				learningId: learning.id,
				index,
				note,
				nearTo: learning.nearTo?.[index] ?? [],
				mayDecide: learning.mayDecide,
				proposedAt: learning.proposedAt,
			};
			return checked.has(keyOf(one)) ? [] : [one];
		}),
	);
}

/**
 * The notes of the learnings that wait, one at a time, for both apps:
 * True keeps one, Not true deletes it, Change it tells a note in its place,
 * and a person can tell a note of their own. A note leaves `waiting` from
 * the moment its decision goes out, and stays out until the list reads
 * again without it, also when the screen that sent it is closed by then.
 * One that fails comes back, and `onFailed` says why. Each sends at once:
 * the screen decides whether to ask first.
 */
export function useCheckNotes(
	orpc: ApiQueryUtils,
	options: { onFailed?: (failure: NoteFailure) => void } = {},
) {
	const { onFailed } = options;
	const knowledge = useMemo(() => createKnowledgeQueries(orpc), [orpc]);
	const settleOptions = useMemo(() => knowledge.settleNote(), [knowledge]);
	const tellOptions = useMemo(() => knowledge.tell(), [knowledge]);
	const queryClient = useQueryClient();

	const readAgain = () =>
		Promise.all(
			[knowledge.learningsKey(), knowledge.getKey(), knowledge.reviewKey()].map(
				(queryKey) => queryClient.invalidateQueries({ queryKey }),
			),
		);
	const settleNote = useMutation({ ...settleOptions, onSettled: readAgain });
	const tellNote = useMutation({ ...tellOptions, onSettled: readAgain });

	const settledKeys = useMutationState({
		filters: { mutationKey: settleOptions.mutationKey },
		select: checkedKey,
	});
	const replacedKeys = useMutationState({
		filters: { mutationKey: tellOptions.mutationKey },
		select: checkedKey,
	});
	const checkedList = [...settledKeys, ...replacedKeys].filter(
		(key): key is string => key !== null,
	);
	const checkedId = checkedList.join("\n");
	// biome-ignore lint/correctness/useExhaustiveDependencies: the joined keys say when the set changes.
	const checked: ReadonlySet<string> = useMemo(
		() => new Set(checkedList),
		[checkedId],
	);

	/** The notes that wait for a person, in the order of the learnings, without those on their way. */
	const waiting = useCallback(
		(learnings: readonly WaitingLearning[]) => notesToCheck(learnings, checked),
		[checked],
	);

	const settleMutate = settleNote.mutate;
	/** True (`keep`) or Not true (`delete`). */
	const settle = useCallback(
		(note: NoteToCheck, decision: "keep" | "delete") => {
			const { projectId, learningId, index } = note;
			settleMutate(
				{ projectId, learningId, index, note: note.note, decision },
				{
					onError: (error) =>
						onFailed?.({
							title:
								decision === "keep"
									? "The note was not kept"
									: "The note was not deleted",
							message: error.message,
							note,
						}),
				},
			);
		},
		[settleMutate, onFailed],
	);

	const tellMutate = tellNote.mutateAsync;
	/**
	 * Keeps a note the person wrote, in place of `replaces` when given
	 * (Change it). Resolves true once it is kept, false when it failed.
	 */
	const tell = useCallback(
		async (input: {
			projectId: string;
			note: string;
			replaces?: NoteToCheck;
		}): Promise<boolean> => {
			const { projectId, note, replaces } = input;
			try {
				await tellMutate({
					projectId,
					note,
					...(replaces
						? {
								replaces: {
									learningId: replaces.learningId,
									index: replaces.index,
									note: replaces.note,
								},
							}
						: {}),
				});
				return true;
			} catch (error) {
				onFailed?.({
					title: "The note was not kept",
					message: messageOf(error),
					note: replaces ?? null,
				});
				return false;
			}
		},
		[tellMutate, onFailed],
	);

	return { waiting, settle, tell, telling: tellNote.isPending };
}
