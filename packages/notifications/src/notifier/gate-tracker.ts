import { gateKey, parseGateKey } from "../contract";
import type { OpenGateRef, RunEvent } from "./sources";

/** What a batch of run events did to the Gates of one Space. */
export type GateChanges = {
	/** Gates that opened and are still open: tell them. */
	opened: { key: string; runId: string; stepId: string }[];
	/** Gates that no longer wait: take their notifications back. */
	closed: string[];
};

/**
 * The open Gates the notifier knows, by Space, and what the engine last
 * said of each. A Gate is known once it was told or found at the baseline:
 * a Gate that a read shows before its `GateOpened` arrives is told when
 * that event comes.
 */
export type GateTracker = {
	/** Reads the open Gates of each Space: they are the baseline. */
	baseline(spaceIds: readonly string[]): Promise<void>;
	/**
	 * What the events of one Space opened and closed. It reads the open
	 * Gates only when a Gate opened, or when an event is of a run with a
	 * known Gate: other events cannot change them.
	 */
	apply(spaceId: string, events: readonly RunEvent[]): Promise<GateChanges>;
	/** Whether the notifier knows the Gate of the key as open. */
	isOpen(spaceId: string, key: string): boolean;
	/** What the engine last said of an open Gate: its lock-screen mark and options. */
	factsOf(spaceId: string, key: string): OpenGateRef | undefined;
	/** The known open Gates of every Space. */
	open(): { spaceId: string; key: string; runId: string; stepId: string }[];
};

/** Tracks the open Gates of each Space from the engine's reads. */
export function createGateTracker(
	openGates: (spaceId: string) => Promise<OpenGateRef[]>,
): GateTracker {
	/** The open Gates this notifier knows, by Space. */
	const known = new Map<string, Set<string>>();
	/** The open Gates of the last read of each Space, by key. */
	const facts = new Map<string, Map<string, OpenGateRef>>();

	async function read(spaceId: string): Promise<Map<string, OpenGateRef>> {
		const gates = await openGates(spaceId);
		const open = new Map(gates.map((gate) => [gateKey(gate), gate]));
		facts.set(spaceId, open);
		return open;
	}

	return {
		async baseline(spaceIds) {
			for (const spaceId of spaceIds) {
				known.set(spaceId, new Set((await read(spaceId)).keys()));
			}
		},

		async apply(spaceId, events) {
			const keys = known.get(spaceId) ?? new Set<string>();
			known.set(spaceId, keys);
			const asked = new Set(
				events
					.filter((e) => e.type === "GateOpened" && e.stepId !== null)
					.map((e) => gateKey({ runId: e.runId, stepId: e.stepId as string })),
			);
			const runsWithGates = new Set(
				[...keys].map((key) => parseGateKey(key)?.runId),
			);
			if (asked.size === 0 && !events.some((e) => runsWithGates.has(e.runId))) {
				return { opened: [], closed: [] };
			}
			const now = await read(spaceId);
			const closed = [...keys].filter((key) => !now.has(key));
			for (const key of closed) keys.delete(key);
			const opened: GateChanges["opened"] = [];
			for (const key of asked) {
				const gate = parseGateKey(key);
				if (!gate || !now.has(key) || keys.has(key)) continue;
				keys.add(key);
				opened.push({ key, ...gate });
			}
			return { opened, closed };
		},

		isOpen: (spaceId, key) => known.get(spaceId)?.has(key) ?? false,
		factsOf: (spaceId, key) => facts.get(spaceId)?.get(key),
		open: () =>
			[...known].flatMap(([spaceId, keys]) =>
				[...keys].flatMap((key) => {
					const gate = parseGateKey(key);
					return gate ? [{ spaceId, key, ...gate }] : [];
				}),
			),
	};
}
