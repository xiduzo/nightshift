/**
 * The pins and skips of a test run (ADR 27), as a person marks them on the
 * nodes in the editor. They live in this browser only, per project and
 * flow, never in the flow. The start of a test run carries them
 * (`testRequest`). Pure: the hook passes the storage in.
 */
import type { PinRef } from "@nightshift/client";
import { type Flow, standInOutcomes, standsIn } from "@nightshift/flows";

/** What a person marked on the nodes of one flow for its next test run. */
export type TestMarks = {
	/** The pinned outputs, by node id: a step of an earlier run. */
	readonly pinned: Readonly<Record<string, PinRef>>;
	/** The skipped nodes, by node id: the outcome each gives. */
	readonly skipped: Readonly<Record<string, string>>;
};

/** The mark on one node. */
export type TestMark =
	| { kind: "pinned"; pin: PinRef }
	| { kind: "skipped"; outcome: string };

export const NO_MARKS: TestMarks = { pinned: {}, skipped: {} };

/** The most pins and skips one test run takes, together (the engine's limit). */
export const TEST_MARKS_MAX = 50;

/** Where this browser keeps the marks of a flow. */
export function marksKey(projectId: string, flowName: string): string {
	return `nightshift:test:${projectId}:${flowName}`;
}

/** The marks that `raw` holds. Anything that does not fit is left out. */
export function parseMarks(raw: string | null | undefined): TestMarks {
	if (!raw) return NO_MARKS;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return NO_MARKS;
	}
	if (!isRecord(value)) return NO_MARKS;
	const pinned: Record<string, PinRef> = {};
	if (isRecord(value.pinned)) {
		for (const [nodeId, pin] of Object.entries(value.pinned)) {
			if (isRecord(pin) && isId(nodeId) && isId(pin.runId) && isId(pin.stepId))
				pinned[nodeId] = { runId: pin.runId, stepId: pin.stepId };
		}
	}
	const skipped: Record<string, string> = {};
	if (isRecord(value.skipped)) {
		for (const [nodeId, outcome] of Object.entries(value.skipped)) {
			// A node is pinned or skipped, never both: the pin stays.
			if (isId(nodeId) && isId(outcome) && !Object.hasOwn(pinned, nodeId))
				skipped[nodeId] = outcome;
		}
	}
	return { pinned, skipped };
}

/** The marks `storage` keeps under `key`. Storage can be missing or blocked. */
export function readMarks(
	storage: Pick<Storage, "getItem"> | undefined,
	key: string,
): TestMarks {
	try {
		return parseMarks(storage?.getItem(key));
	} catch {
		return NO_MARKS;
	}
}

/** Keeps `marks` under `key`. No marks: nothing is kept. */
export function writeMarks(
	storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
	key: string,
	marks: TestMarks,
): void {
	try {
		if (markCount(marks).total === 0) storage?.removeItem(key);
		else storage?.setItem(key, JSON.stringify(marks));
	} catch {
		// Not kept: the marks last until the page reloads.
	}
}

/**
 * The marks that still fit `flow`: of nodes it has, that a test run may
 * pin or skip, and for a skip one of the node's outcomes. The same object
 * when all fit.
 */
export function pruneMarks(
	marks: TestMarks,
	flow: Pick<Flow, "nodes">,
): TestMarks {
	const nodes = new Map(flow.nodes.map((node) => [node.id, node]));
	const pinned = Object.entries(marks.pinned).filter(([nodeId]) => {
		const node = nodes.get(nodeId);
		return node !== undefined && standsIn(node);
	});
	const skipped = Object.entries(marks.skipped).filter(([nodeId, outcome]) => {
		const node = nodes.get(nodeId);
		return node !== undefined && standInOutcomes(node).includes(outcome);
	});
	if (
		pinned.length === Object.keys(marks.pinned).length &&
		skipped.length === Object.keys(marks.skipped).length
	)
		return marks;
	return {
		pinned: Object.fromEntries(pinned),
		skipped: Object.fromEntries(skipped),
	};
}

/** The mark on a node, or null. */
export function markOf(marks: TestMarks, nodeId: string): TestMark | null {
	const pin = Object.hasOwn(marks.pinned, nodeId)
		? marks.pinned[nodeId]
		: undefined;
	if (pin) return { kind: "pinned", pin };
	const outcome = Object.hasOwn(marks.skipped, nodeId)
		? marks.skipped[nodeId]
		: undefined;
	return outcome === undefined ? null : { kind: "skipped", outcome };
}

/** `marks` with `mark` on the node, in place of the one it had. Null: no mark. */
export function markNode(
	marks: TestMarks,
	nodeId: string,
	mark: TestMark | null,
): TestMarks {
	const { [nodeId]: _pin, ...pinned } = marks.pinned;
	const { [nodeId]: _skip, ...skipped } = marks.skipped;
	return {
		pinned:
			mark?.kind === "pinned" ? { ...pinned, [nodeId]: mark.pin } : pinned,
		skipped:
			mark?.kind === "skipped"
				? { ...skipped, [nodeId]: mark.outcome }
				: skipped,
	};
}

/** Whether a new mark on the node would take the run past its limit. */
export function isFull(marks: TestMarks, nodeId: string): boolean {
	return (
		markOf(marks, nodeId) === null && markCount(marks).total >= TEST_MARKS_MAX
	);
}

export type MarkCount = { pinned: number; skipped: number; total: number };

export function markCount(marks: TestMarks): MarkCount {
	const pinned = Object.keys(marks.pinned).length;
	const skipped = Object.keys(marks.skipped).length;
	return { pinned, skipped, total: pinned + skipped };
}

/** The marks in a few words: "2 pinned · 1 skipped". */
export function marksText({ pinned, skipped }: MarkCount): string {
	return [
		pinned > 0 ? `${pinned} pinned` : null,
		skipped > 0 ? `${skipped} skipped` : null,
	]
		.filter((part) => part !== null)
		.join(" · ");
}

/** What the start of a test run carries (`runs.start` `test`). No marks: none. */
export function testRequest(marks: TestMarks):
	| {
			pinned?: Record<string, PinRef>;
			skipped?: Record<string, string>;
	  }
	| undefined {
	const { pinned, skipped } = markCount(marks);
	if (pinned + skipped === 0) return undefined;
	return {
		...(pinned > 0 ? { pinned: { ...marks.pinned } } : {}),
		...(skipped > 0 ? { skipped: { ...marks.skipped } } : {}),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is string {
	return typeof value === "string" && value !== "" && value.length <= 200;
}
