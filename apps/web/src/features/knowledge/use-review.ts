import {
	arrangeTasks,
	learningKey,
	type ReviewTask,
	useSettleLearnings,
} from "@nightshift/client";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/shared/api";
import { knowledgeQueries } from "./queries";

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
export function useReview(projectId: string) {
	const review = useQuery(knowledgeQueries.review(projectId));
	const { dismissed, dismiss } = useDismissed(projectId);
	// The learnings a person just kept or deleted: they wait out the time to take it back here.
	const [held, setHeld] = useState<ReadonlySet<string>>(new Set());
	const [later, setLater] = useState<string[]>([]);
	const [forward, setForward] = useState<string | null>(null);
	const release = (key: string) =>
		setHeld((now) => new Set([...now].filter((other) => other !== key)));
	const { settled, settle: send } = useSettleLearnings(orpc, {
		onFailed: ({ title, message, learning }) => {
			release(learningKey(learning));
			toast.error(`${title}: ${message}`);
		},
	});

	const tasks = useMemo(() => review.data ?? [], [review.data]);
	const queue = useMemo(
		() =>
			arrangeTasks(
				tasks.filter(
					(task) =>
						task.kind !== "learning" ||
						!(
							held.has(learningKey(task.learning)) ||
							settled.has(learningKey(task.learning))
						),
				),
				{ gone: dismissed, later, forward },
			),
		[tasks, dismissed, held, settled, later, forward],
	);

	// What waits to go out, so that leaving the page can send it.
	const waiting = useRef(new Map<string, () => void>());
	useEffect(() => {
		const list = waiting.current;
		return () => {
			for (const send of list.values()) send();
		};
	}, []);

	const settle = (
		task: Extract<ReviewTask, { kind: "learning" }>,
		decision: "keep" | "delete",
	) => {
		const key = learningKey(task.learning);
		const goOut = () => {
			clearTimeout(timer);
			waiting.current.delete(key);
			send(task.learning, decision);
		};
		const timer = setTimeout(goOut, UNDO_MS);
		waiting.current.set(key, goOut);
		setHeld((now) => new Set([...now, key]));
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
						waiting.current.delete(key);
						release(key);
						setForward(task.id);
					},
				},
			},
		);
	};

	return {
		/** Everything to do, for the progress. */
		total: tasks.length,
		queue,
		loading: review.isLoading,
		error: review.error,
		settle,
		dismiss,
		/** The task comes up again after the others. */
		putOff: (id: string) => {
			setForward(null);
			setLater((now) => [...now.filter((other) => other !== id), id]);
		},
		bringForward: setForward,
		/** The task about this node of the Map comes up first. */
		bringForwardNode: (node: string) =>
			setForward(tasks.find((task) => task.node === node)?.id ?? null),
	};
}
