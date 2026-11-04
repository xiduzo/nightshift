import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Knowledge } from "@/shared/api";
import { fileUse, isUnused } from "./file-use";
import { knowledgeMutations, knowledgeQueries } from "./queries";
import {
	arrangeTasks,
	reviewTasks,
	type WaitingLearning,
} from "./review-queue";

/** How long a person can take back a Keep or a Delete, in ms. */
const UNDO_MS = 5000;

function store(): Storage | undefined {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

/** What this browser needs no reminder of, for one project. */
function useDismissed(projectId: string) {
	const key = `nightshift.knowledge-dismissed:${projectId}`;
	const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => {
		try {
			const raw = store()?.getItem(key);
			const list: unknown = raw ? JSON.parse(raw) : [];
			return new Set(Array.isArray(list) ? list.map(String) : []);
		} catch {
			return new Set();
		}
	});
	return {
		dismissed,
		dismiss: (id: string) => {
			const next = new Set([...dismissed, id]);
			setDismissed(next);
			store()?.setItem(key, JSON.stringify([...next]));
		},
	};
}

export type Review = ReturnType<typeof useReview>;

/**
 * The queue of the Review page, kept while a person moves between the pages
 * of Knowledge: what waits, in order. Keep and Delete leave the queue at once,
 * and go out after a few seconds, so a person can take them back. Leaving
 * Knowledge sends them.
 */
export function useReview(projectId: string, knowledge: Knowledge) {
	const queryClient = useQueryClient();
	const learnings = useQuery(knowledgeQueries.learnings(projectId));
	const questions = useQuery(knowledgeQueries.questions(projectId));
	const use = useQuery(knowledgeQueries.use(projectId));
	const { dismissed, dismiss } = useDismissed(projectId);
	const [settling, setSettling] = useState<ReadonlySet<string>>(new Set());
	const [later, setLater] = useState<string[]>([]);
	const [forward, setForward] = useState<string | null>(null);

	const tasks = useMemo(() => {
		const used = fileUse(use.data);
		return reviewTasks({
			syncs: knowledge.syncs,
			learnings: learnings.data ?? [],
			asked: questions.data?.asked ?? [],
			unused: knowledge.files.filter((file) => isUnused(used, file)),
		});
	}, [knowledge, learnings.data, questions.data, use.data]);

	const queue = useMemo(
		() =>
			arrangeTasks(tasks, {
				gone: new Set([...dismissed, ...settling]),
				later,
				forward,
			}),
		[tasks, dismissed, settling, later, forward],
	);

	const unsettle = (id: string) =>
		setSettling((now) => new Set([...now].filter((other) => other !== id)));
	const readAgain = () =>
		Promise.all(
			[knowledgeQueries.learningsKey(), knowledgeQueries.getKey()].map(
				(queryKey) => queryClient.invalidateQueries({ queryKey }),
			),
		);
	const failed = (what: string, id: string, error: Error) => {
		unsettle(`learning:${id}`);
		toast.error(`${what}: ${error.message}`);
	};
	const keep = useMutation({
		...knowledgeMutations.keepLearning(),
		onError: (error, { id }) => failed("The learning was not kept", id, error),
		onSettled: readAgain,
	});
	const remove = useMutation({
		...knowledgeMutations.deleteLearning(),
		onError: (error, { id }) =>
			failed("The learning was not deleted", id, error),
		onSettled: readAgain,
	});

	// What waits to go out, so that leaving the page can send it.
	const waiting = useRef(new Map<string, () => void>());
	useEffect(() => {
		const list = waiting.current;
		return () => {
			for (const send of list.values()) send();
		};
	}, []);

	const settle = (learning: WaitingLearning, decision: "keep" | "delete") => {
		const id = `learning:${learning.id}`;
		const input = { projectId, id: learning.id };
		const send = () => {
			clearTimeout(timer);
			waiting.current.delete(id);
			if (decision === "keep") keep.mutate(input);
			else remove.mutate(input);
		};
		const timer = setTimeout(send, UNDO_MS);
		waiting.current.set(id, send);
		setSettling((now) => new Set([...now, id]));
		setForward(null);
		toast(
			decision === "keep"
				? "Kept. Agents read it in later runs."
				: "Deleted. Agents do not read it.",
			{
				duration: UNDO_MS,
				action: {
					label: "Undo",
					onClick: () => {
						clearTimeout(timer);
						waiting.current.delete(id);
						unsettle(id);
						setForward(id);
					},
				},
			},
		);
	};

	return {
		/** Everything to do, for the progress. */
		total: tasks.length,
		queue,
		loading: learnings.isLoading,
		error: learnings.error,
		settle,
		dismiss,
		/** The task comes up again after the others. */
		putOff: (id: string) => {
			setForward(null);
			setLater((now) => [...now.filter((other) => other !== id), id]);
		},
		bringForward: setForward,
	};
}
