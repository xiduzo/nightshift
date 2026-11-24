import type { RowBatch } from "@nightshift/engine";
import type { DeviceStore } from "../../application/ports";
import type { DeviceRow } from "../../domain/paired-device";

/**
 * A statement of a batch in memory: a change that runs when the batch
 * runs. The twins of the registry make and run them (`runInMemory`).
 */
type Change = () => void;

/** A batch of in-memory changes, as the ports name it. */
export function inMemoryBatch(...changes: Change[]): RowBatch {
	return changes as unknown as RowBatch;
}

/** Runs a batch of in-memory changes, in order. */
export function runInMemory(batch: RowBatch): void {
	for (const change of batch as unknown as Change[]) change();
}

/** A row as a test adds it: the facts it does not name are the defaults of a new row. */
export function deviceRow(row: Partial<DeviceRow> & { id: string }): DeviceRow {
	return {
		name: row.id,
		platform: "linux",
		homeHost: null,
		lastSeenAt: null,
		ownerId: null,
		dev: false,
		machine: null,
		self: false,
		createdAt: 0,
		revokedAt: null,
		...row,
	};
}

/**
 * `DeviceStore` in memory: the `device` rows of one Replica, in the order
 * they came. A test adds a row (`add`) where the real adapter would find
 * one, and reads what the Commands' Walker became (`commandWalkers`).
 */
export function inMemoryDeviceStore(options: { now?: () => number } = {}) {
	const now = options.now ?? (() => 0);
	const rows = new Map<string, DeviceRow>();
	/** The Walker of each Command, by Command id: what an adoption renames. */
	const commandWalkers = new Map<string, string>();
	const self = () => [...rows.values()].find((row) => row.self) ?? null;
	const pairedRow = (id: string) => {
		const row = rows.get(id);
		return row && !row.self ? row : null;
	};
	const copy = (row: DeviceRow | null) => (row ? { ...row } : null);
	const twin = {
		rows,
		commandWalkers,
		/** Adds a row, as the real adapter would find it. */
		add(row: Partial<DeviceRow> & { id: string }) {
			rows.set(row.id, deviceRow({ createdAt: now(), ...row }));
		},
		async self() {
			return copy(self());
		},
		async selfId() {
			return self()?.id ?? null;
		},
		async selfOwnerId() {
			return self()?.ownerId ?? null;
		},
		async addSelf(row: { id: string; name: string; platform: string }) {
			if (rows.has(row.id) || self()) return;
			twin.add({ ...row, self: true });
		},
		async setFacts(id: string, facts: { name: string; platform?: string }) {
			const row = rows.get(id);
			if (row) rows.set(id, { ...row, ...facts });
		},
		async setOwner(id: string, personId: string) {
			const row = rows.get(id);
			if (row) rows.set(id, { ...row, ownerId: personId });
		},
		async adopt(move: { row: DeviceRow; to: string; engine: RowBatch }) {
			const from = move.row.id;
			const fromRow = rows.get(from);
			if (fromRow) rows.set(from, { ...fromRow, self: false });
			const existing = rows.get(move.to);
			rows.set(
				move.to,
				existing
					? { ...existing, self: true }
					: { ...move.row, id: move.to, self: true },
			);
			runInMemory(move.engine);
			for (const [id, walker] of commandWalkers) {
				if (walker === from) commandWalkers.set(id, move.to);
			}
			rows.delete(from);
		},
		async paired(id: string) {
			return copy(pairedRow(id));
		},
		async pairedOwners() {
			return [...rows.values()]
				.filter((row) => !row.self)
				.map((row) => ({ id: row.id, ownerId: row.ownerId }));
		},
		joinRows(row: Parameters<DeviceStore["joinRows"]>[0]): RowBatch {
			return inMemoryBatch(() => {
				const values = {
					name: row.name,
					platform: row.platform,
					ownerId: row.ownerId,
					homeHost: row.homeHost,
					revokedAt: null,
					...(row.machine ? { machine: row.machine } : {}),
				};
				const existing = rows.get(row.id);
				rows.set(
					row.id,
					existing
						? { ...existing, ...values }
						: deviceRow({ id: row.id, createdAt: now(), ...values }),
				);
			});
		},
		async describe(
			id: string,
			facts: { name: string; dev: boolean; machine: string | null | undefined },
		) {
			const row = rows.get(id);
			if (!row) return;
			rows.set(id, {
				...row,
				name: facts.name,
				dev: facts.dev,
				...(facts.machine === undefined ? {} : { machine: facts.machine }),
			});
		},
		async sameMachine(ownerId: string, machine: string, exceptId: string) {
			const found = [...rows.values()]
				.filter(
					(row) =>
						row.ownerId === ownerId &&
						row.machine === machine &&
						!row.self &&
						!row.dev &&
						row.id !== exceptId,
				)
				.sort(
					(a, b) =>
						Number(a.revokedAt !== null) - Number(b.revokedAt !== null) ||
						(b.lastSeenAt ?? -1) - (a.lastSeenAt ?? -1),
				)[0];
			return copy(found ?? null);
		},
		async ownedBy(ownerId: string) {
			return [...rows.values()]
				.filter((row) => row.ownerId === ownerId && !row.self)
				.sort(
					(a, b) =>
						Number(a.revokedAt !== null) - Number(b.revokedAt !== null) ||
						b.createdAt - a.createdAt,
				)
				.map((row) => ({ ...row }));
		},
		async markSeen(id: string, at: number) {
			const row = pairedRow(id);
			if (!row) return null;
			rows.set(id, { ...row, lastSeenAt: at });
			return { id: row.id, ownerId: row.ownerId };
		},
		revokeRows(id: string, at: number): RowBatch {
			return inMemoryBatch(() => {
				const row = rows.get(id);
				if (row) rows.set(id, { ...row, revokedAt: at });
			});
		},
		async forget(id: string, engine: RowBatch) {
			runInMemory(engine);
			if (pairedRow(id)) rows.delete(id);
		},
		async names(ids: readonly string[]) {
			return new Map(
				ids.flatMap((id) => {
					const row = rows.get(id);
					return row ? [[id, row.name] as const] : [];
				}),
			);
		},
		async homePersons() {
			const owners = [...rows.values()].flatMap((row) =>
				!row.self &&
				row.homeHost !== null &&
				row.revokedAt === null &&
				row.ownerId
					? [row.ownerId]
					: [],
			);
			return [...new Set(owners)];
		},
	};
	return twin satisfies DeviceStore;
}

export type InMemoryDeviceStore = ReturnType<typeof inMemoryDeviceStore>;
