import {
	type NodeSample,
	type PinRef,
	pinnedSamples,
	type RunDetail,
} from "@nightshift/client";
import type { Flow } from "@nightshift/flows";
import { type UseQueryResult, useQueries } from "@tanstack/react-query";
import { createContext, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { runQueries } from "@/features/runs/flows-port";
import {
	isFull,
	type MarkCount,
	markCount,
	markNode,
	marksKey,
	NO_MARKS,
	pruneMarks,
	readMarks,
	TEST_MARKS_MAX,
	type TestMark,
	type TestMarks,
	writeMarks,
} from "./marks";

/** The pins and skips of the flow in the editor, and the ways to change them. */
export type TestMarksApi = {
	/** The marks that fit the draft. */
	marks: TestMarks;
	count: MarkCount;
	/** The output of each pin, by node id, once its run loads. */
	pinned: ReadonlyMap<string, NodeSample>;
	/** A pinned run still loads. */
	pinsLoading: boolean;
	pin: (nodeId: string, pin: PinRef) => void;
	skip: (nodeId: string, outcome: string) => void;
	/** "Unpin output" and "Stop skipping". */
	unmark: (nodeId: string) => void;
	clear: () => void;
};

/**
 * The marks of the flow in the editor, for the node inspector. Null
 * outside the editor.
 */
export const TestMarksContext = createContext<TestMarksApi | null>(null);

function storage(): Storage | undefined {
	try {
		return window.localStorage;
	} catch {
		return undefined;
	}
}

/** The pinned runs that loaded, and whether one still loads. */
function details(results: UseQueryResult<RunDetail>[]): {
	runs: RunDetail[];
	pending: boolean;
} {
	return {
		runs: results.flatMap((result) => (result.data ? [result.data] : [])),
		pending: results.some((result) => result.isPending),
	};
}

/**
 * The pins and skips this browser keeps for the flow `flowName`. A mark of
 * a node the draft lost stays in this browser, so an undo brings it back.
 * The next change of a mark drops it.
 */
export function useTestMarks({
	projectId,
	flowName,
	flow,
}: {
	projectId: string;
	flowName: string;
	flow: Flow;
}): TestMarksApi {
	// The editor mounts anew for another flow, so the key holds.
	const key = marksKey(projectId, flowName);
	const [all, setAll] = useState(() => readMarks(storage(), key));
	const marks = useMemo(() => pruneMarks(all, flow), [all, flow]);

	const change = useCallback(
		(nodeId: string, mark: TestMark | null) => {
			if (mark !== null && isFull(marks, nodeId)) {
				toast.error(
					`A test run takes at most ${TEST_MARKS_MAX} pins and skips.`,
				);
				return;
			}
			const next = markNode(marks, nodeId, mark);
			writeMarks(storage(), key, next);
			setAll(next);
		},
		[marks, key],
	);
	const clear = useCallback(() => {
		writeMarks(storage(), key, NO_MARKS);
		setAll(NO_MARKS);
	}, [key]);

	const runIds = useMemo(
		() => [...new Set(Object.values(marks.pinned).map((pin) => pin.runId))],
		[marks.pinned],
	);
	const loaded = useQueries({
		queries: runIds.map((runId) => ({
			...runQueries.get(runId),
			meta: { quietErrors: true },
		})),
		combine: details,
	});
	const pinned = useMemo(
		() => pinnedSamples(loaded.runs, marks.pinned, flow),
		[loaded.runs, marks.pinned, flow],
	);

	return useMemo(
		() => ({
			marks,
			count: markCount(marks),
			pinned,
			pinsLoading: loaded.pending,
			pin: (nodeId, pin) => change(nodeId, { kind: "pinned", pin }),
			skip: (nodeId, outcome) => change(nodeId, { kind: "skipped", outcome }),
			unmark: (nodeId) => change(nodeId, null),
			clear,
		}),
		[marks, pinned, loaded.pending, change, clear],
	);
}
