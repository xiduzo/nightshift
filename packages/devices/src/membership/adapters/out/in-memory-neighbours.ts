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

/** In-memory twins for neighbour ports of membership. */
export function inMemoryPersonalSpaces(
	state: { personalId?: string | null; existing?: Set<string> } = {},
): PersonalSpaces & {
	setPersonalId(id: string | null): void;
} {
	let personalId = state.personalId ?? null;
	const existing = state.existing ?? new Set<string>();
	return {
		personalId: async () => personalId,
		exists: async (spaceId) => existing.has(spaceId),
		adoptBatch: async () => [] as unknown as RowBatch,
		splitBatch: async () => [] as unknown as RowBatch,
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

export function inMemoryWait(): Wait & { sleeps: number[] } {
	const sleeps: number[] = [];
	return {
		sleeps,
		async sleep(ms) {
			sleeps.push(ms);
		},
	};
}

export function inMemoryIds(next = "space-new"): Ids {
	return { spaceId: () => next };
}

export function inMemoryBatches(): Batches & { ran: RowBatch[] } {
	const ran: RowBatch[] = [];
	return {
		ran,
		async run(batch) {
			ran.push(batch);
		},
	};
}

export function inMemoryEngineKernel(
	nightShift: Actor = { nightShift: true },
): EngineKernel {
	return {
		nightShift,
		isHostUnreachable: () => false,
	};
}

export function inMemoryDeviceCopies(): DeviceCopiesPort & {
	kept: string[][];
} {
	const kept: string[][] = [];
	return {
		kept,
		async keep(deviceIds) {
			kept.push([...deviceIds]);
		},
	};
}
