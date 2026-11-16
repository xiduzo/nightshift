import type { LandedFact } from "@nightshift/engine";
import { DEFAULT_GATE_URGENCY, type GateUrgency } from "@nightshift/flows";

import { gateKey, parseGateKey } from "../contract";
import type { OpenGateRef } from "./sources";

/** What a landing did to the Gates of one Space. */
export type GateChanges = {
	/** Gates that opened and are still open: tell them. */
	opened: {
		key: string;
		runId: string;
		stepId: string;
		/** How soon it needs an answer: `today` when the fact names none. */
		urgency: GateUrgency;
	}[];
	/** Gates that no longer wait: take their notifications back. */
	closed: string[];
};

/**
 * The open Gates the notifier knows, by Space, and what the engine last
 * said of each. A Gate is known once it was told or found at the baseline:
 * a Gate that a read shows before its fact arrives is told when that
 * fact comes.
 *
 * A Gate with an answer on its way to the Device that walks its run
 * (`answerPending`) waits for nobody: it counts as closed. The tracker
 * keeps it aside. When that Device refuses the answer, the Gate waits
 * again: it is known as open again, and nobody hears of it again. When
 * the answer lands, the Gate goes without a second close.
 */
export type GateTracker = {
	/** Reads the open Gates of each Space: they are the baseline. */
	baseline(spaceIds: readonly string[]): Promise<void>;
	/**
	 * What the facts of one Space opened and closed. It reads the open
	 * Gates only when a Gate opened, or when a fact is of a run with a
	 * known Gate: other facts cannot change them.
	 */
	apply(spaceId: string, facts: readonly LandedFact[]): Promise<GateChanges>;
	/**
	 * What changed of the run's Gates without a fact: an answer to one of
	 * them is now on its way, or its Walker refused it. It reads the open
	 * Gates only when the run has a Gate the tracker keeps. It opens nothing.
	 */
	recheck(spaceId: string, runId: string): Promise<GateChanges>;
	/** Whether the notifier knows the Gate of the key as open. */
	isOpen(spaceId: string, key: string): boolean;
	/** What the engine last said of an open Gate: its lock-screen mark and options. */
	factsOf(spaceId: string, key: string): OpenGateRef | undefined;
	/** The known open Gates of every Space. */
	open(): { spaceId: string; key: string; runId: string; stepId: string }[];
};

/** The Gates of one Space, as the notifier knows them. */
type SpaceGates = {
	/** The Gates that wait for an answer. */
	known: Set<string>;
	/** The open Gates with an answer on its way: closed for the notifier. */
	answered: Set<string>;
};

/** Tracks the open Gates of each Space from the engine's reads. */
export function createGateTracker(
	openGates: (spaceId: string) => Promise<OpenGateRef[]>,
): GateTracker {
	const spaces = new Map<string, SpaceGates>();
	/** The open Gates of the last read of each Space, by key. */
	const facts = new Map<string, Map<string, OpenGateRef>>();

	function gatesOf(spaceId: string): SpaceGates {
		let gates = spaces.get(spaceId);
		if (!gates) {
			gates = { known: new Set(), answered: new Set() };
			spaces.set(spaceId, gates);
		}
		return gates;
	}

	async function read(spaceId: string): Promise<Map<string, OpenGateRef>> {
		const gates = await openGates(spaceId);
		const open = new Map(gates.map((gate) => [gateKey(gate), gate]));
		facts.set(spaceId, open);
		return open;
	}

	/** Whether the read shows the Gate open, without an answer on its way. */
	function waits(open: Map<string, OpenGateRef>, key: string): boolean {
		const gate = open.get(key);
		return gate !== undefined && !gate.answerPending;
	}

	/**
	 * Brings what the tracker knows in line with a new read. Returns the
	 * Gates that closed: gone, or with an answer on its way.
	 */
	function reconcile(gates: SpaceGates, open: Map<string, OpenGateRef>) {
		const closed: string[] = [];
		for (const key of gates.known) {
			if (waits(open, key)) continue;
			gates.known.delete(key);
			closed.push(key);
			if (open.has(key)) gates.answered.add(key);
		}
		for (const key of gates.answered) {
			if (!open.has(key)) {
				gates.answered.delete(key);
			} else if (waits(open, key)) {
				// The Walker refused the answer: the Gate waits again, told already.
				gates.answered.delete(key);
				gates.known.add(key);
			}
		}
		return closed;
	}

	/** The runs with a Gate the tracker keeps: known, or with an answer on its way. */
	function runsOf(gates: SpaceGates): Set<string | undefined> {
		return new Set(
			[...gates.known, ...gates.answered].map(
				(key) => parseGateKey(key)?.runId,
			),
		);
	}

	return {
		async baseline(spaceIds) {
			for (const spaceId of spaceIds) {
				const open = await read(spaceId);
				const gates: SpaceGates = { known: new Set(), answered: new Set() };
				for (const key of open.keys()) {
					(waits(open, key) ? gates.known : gates.answered).add(key);
				}
				spaces.set(spaceId, gates);
			}
		},

		async apply(spaceId, landed) {
			const gates = gatesOf(spaceId);
			const asked = new Map(
				landed.flatMap((f) =>
					f.kind === "gate-opened"
						? [[gateKey(f), f.urgency ?? DEFAULT_GATE_URGENCY] as const]
						: [],
				),
			);
			const runs = runsOf(gates);
			if (asked.size === 0 && !landed.some((f) => runs.has(f.runId))) {
				return { opened: [], closed: [] };
			}
			const open = await read(spaceId);
			const closed = reconcile(gates, open);
			const opened: GateChanges["opened"] = [];
			for (const [key, urgency] of asked) {
				const gate = parseGateKey(key);
				if (!gate || !waits(open, key) || gates.known.has(key)) continue;
				gates.known.add(key);
				opened.push({ key, ...gate, urgency });
			}
			return { opened, closed };
		},

		async recheck(spaceId, runId) {
			const gates = gatesOf(spaceId);
			if (!runsOf(gates).has(runId)) return { opened: [], closed: [] };
			return { opened: [], closed: reconcile(gates, await read(spaceId)) };
		},

		isOpen: (spaceId, key) => spaces.get(spaceId)?.known.has(key) ?? false,
		factsOf: (spaceId, key) => facts.get(spaceId)?.get(key),
		open: () =>
			[...spaces].flatMap(([spaceId, gates]) =>
				[...gates.known].flatMap((key) => {
					const gate = parseGateKey(key);
					return gate ? [{ spaceId, key, ...gate }] : [];
				}),
			),
	};
}
