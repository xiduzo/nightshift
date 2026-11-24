import type { Actor, RowBatch } from "@nightshift/engine";
import type {
	Batches,
	DeviceCopiesPort,
	EngineKernel,
	Ids,
	PairedDevices,
	PersonalSpaces,
	Wait,
} from "../../application/ports";
import { inMemoryDatabaseCopy } from "./in-memory-database-copy";

export { inMemoryDatabaseCopy };

/** A batch of a twin: its changes land when it runs, as rows do. */
export function inMemoryBatch(...changes: (() => void)[]): RowBatch {
	return changes as unknown as RowBatch;
}

/** Splits a batch: the changes of the twins, and the statements of the database. */
export function splitBatch(batch: RowBatch) {
	const items = batch as unknown as unknown[];
	const isChange = (item: unknown): item is () => void =>
		typeof item === "function";
	return {
		changes: items.filter(isChange),
		statements: items.filter((item) => !isChange(item)),
	};
}

/** The Person's personal Space, and the Space rows that exist. */
export function inMemoryPersonalSpaces(
	state: { personalId?: string | null; existing?: Set<string> } = {},
): PersonalSpaces & {
	setPersonalId(id: string | null): void;
	existing: Set<string>;
	adopted: Parameters<PersonalSpaces["adoptBatch"]>[0][];
	split: Parameters<PersonalSpaces["splitBatch"]>[0][];
} {
	let personalId = state.personalId ?? null;
	const existing = state.existing ?? new Set<string>();
	const adopted: Parameters<PersonalSpaces["adoptBatch"]>[0][] = [];
	const split: Parameters<PersonalSpaces["splitBatch"]>[0][] = [];
	return {
		existing,
		adopted,
		split,
		personalId: async () => personalId,
		exists: async (spaceId) => existing.has(spaceId),
		adoptBatch: async (input) =>
			inMemoryBatch(() => {
				adopted.push(input);
				existing.delete(input.from);
				existing.add(input.to);
				personalId = input.to;
			}),
		splitBatch: async (input) =>
			inMemoryBatch(() => {
				split.push(input);
				existing.add(input.to);
				personalId = input.to;
			}),
		setPersonalId(id) {
			personalId = id;
		},
	};
}

export function inMemoryPairedDevices(
	has = false,
): PairedDevices & { setHasPaired(value: boolean): void } {
	let paired = has;
	return {
		hasPaired: async () => paired,
		setHasPaired(value) {
			paired = value;
		},
	};
}

export function inMemoryWait(
	onSleep: () => void | Promise<void> = () => {},
): Wait & { sleeps: number[] } {
	const sleeps: number[] = [];
	return {
		sleeps,
		async sleep(ms) {
			sleeps.push(ms);
			await onSleep();
		},
	};
}

export function inMemoryIds(next = "space-new"): Ids {
	return { spaceId: () => next };
}

export function inMemoryBatches(
	run: Batches["run"],
): Batches & { ran: RowBatch[] } {
	const ran: RowBatch[] = [];
	return {
		ran,
		async run(batch) {
			await run(batch);
			ran.push(batch);
		},
	};
}

export function inMemoryEngineKernel(
	nightShift: Actor = { nightShift: true },
	isHostUnreachable: EngineKernel["isHostUnreachable"] = () => false,
): EngineKernel {
	return {
		nightShift,
		isHostUnreachable,
	};
}

export function inMemoryDeviceCopies(): DeviceCopiesPort & {
	kept: { id: string; name: string }[][];
} {
	const kept: { id: string; name: string }[][] = [];
	return {
		kept,
		async keep(devices) {
			kept.push([...devices]);
			return [];
		},
	};
}
