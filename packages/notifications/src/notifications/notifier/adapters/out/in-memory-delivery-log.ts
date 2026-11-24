import type {
	Delivery,
	DeliveryChange,
	DeliveryStatus,
} from "../../../../deliveries";
import type { DeliveryLog } from "../../application/ports";

/** The statuses of an entry that can still reach a screen, or did. */
const LIVE: readonly DeliveryStatus[] = ["sending", "held", "quiet", "sent"];

/** The kinds that stay in the log while they can still reach a screen. */
const KEPT_WHILE_LIVE: readonly string[] = ["gate-opened", "device-wait"];

/**
 * The delivery log in memory, in the order of its first claims. `rows`
 * shows what it holds, so a test can read an entry whole.
 */
export function inMemoryDeliveryLog() {
	const rows = new Map<string, Delivery>();
	const id = (personId: string, key: string) => `${personId}\u0000${key}`;
	const copy = (row: Delivery): Delivery => ({
		...row,
		sentTo: [...row.sentTo],
		heldFor: [...row.heldFor],
	});
	const defined = (change: DeliveryChange): DeliveryChange =>
		Object.fromEntries(
			Object.entries(change).filter(([, value]) => value !== undefined),
		);
	const all = (keep: (row: Delivery) => boolean) =>
		[...rows.values()].filter(keep).map(copy);
	const log = {
		/** Every entry, in the order of its first claim. */
		rows: () => [...rows.values()].map(copy),
		/** The Person's entry of the key, or undefined. */
		entry: (personId: string, key: string) => {
			const row = rows.get(id(personId, key));
			return row ? copy(row) : undefined;
		},
		async claim(claim, change, now) {
			const values = {
				...claim,
				title: claim.title ?? null,
				body: claim.body ?? null,
				...defined(change),
				status: change.status,
				createdAt: now,
			};
			const before = rows.get(id(claim.personId, claim.key));
			if (!before) {
				rows.set(id(claim.personId, claim.key), {
					dueAt: null,
					sentAt: null,
					withdrawnAt: null,
					...values,
					sentTo: [...(values.sentTo ?? [])],
					heldFor: [...(values.heldFor ?? [])],
				});
				return true;
			}
			if (before.status !== "withdrawn") return false;
			rows.set(id(claim.personId, claim.key), {
				...before,
				...values,
				sentTo: [...(values.sentTo ?? [])],
				heldFor: [...(values.heldFor ?? [])],
				sentAt: values.sentAt ?? null,
				withdrawnAt: null,
			});
			return true;
		},
		async update(personId, key, change) {
			const row = rows.get(id(personId, key));
			if (!row) return;
			const set = defined(change);
			rows.set(id(personId, key), {
				...row,
				...set,
				...(set.sentTo ? { sentTo: [...set.sentTo] } : {}),
				...(set.heldFor ? { heldFor: [...set.heldFor] } : {}),
			});
		},
		live: async (key) =>
			all((row) => row.key === key && LIVE.includes(row.status)),
		liveOfKind: async (kind) =>
			all((row) => row.kind === kind && LIVE.includes(row.status)),
		held: async () => all((row) => row.status === "held"),
		sending: async () => all((row) => row.status === "sending"),
		quiet: async () => all((row) => row.status === "quiet"),
		async prune(before) {
			let pruned = 0;
			for (const [at, row] of [...rows]) {
				const kept =
					KEPT_WHILE_LIVE.includes(row.kind) && LIVE.includes(row.status);
				if (row.createdAt < before && !kept) {
					rows.delete(at);
					pruned += 1;
				}
			}
			return pruned;
		},
	} satisfies DeliveryLog & Record<string, unknown>;
	return log;
}
