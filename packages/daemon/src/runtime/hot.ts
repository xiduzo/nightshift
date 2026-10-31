import type { PriceUpdates } from "@nightshift/agents";
import type { Database } from "@nightshift/db";
import type { KeptDevices } from "@nightshift/devices";
import type {
	KnowledgeSearch,
	OllamaService,
	SyncedDocuments,
} from "@nightshift/engine";
import type { GitHubClones, ProjectCopies } from "@nightshift/engine/projects";
import type { InAppChannel, Notifications } from "@nightshift/notifications";
import type { Telemetry } from "@nightshift/telemetry";

import type { KeepAwake } from "../keep-awake";
import type { KeptSync } from "../sync";
import type { Lease } from "./lease";

/**
 * What one daemon process keeps across `bun --hot` reloads. `bun --hot`
 * evaluates every module again on each reload, in the same process, and
 * keeps `globalThis`. Each piece that must have one owner per process has
 * a slot here, and the daemon names its lifecycle once (`hotSlots`):
 *
 * - kept: the database client (one per database, so a reload leaks none),
 *   the lease, the synced documents (one writer each), the
 *   in-app channel (an open notification stream outlives a reload), the
 *   clones from GitHub, and the relay (`keepSync`: its connections stay,
 *   and it is bound to the newest daemon's closures). Bun reloads a
 *   listener of the same `id` in place;
 * - replaced, the one before stopped first: the notifier, the keep-awake,
 *   the export to monitoring, the Ollama (and the `ollama serve` it
 *   started), the project copies, the scheduler, the price list, the facts
 *   timer and the knowledge timers;
 * - handed over: the devices (`startDevices` fills `nightshiftDevices`
 *   itself: its engine lets go of its runs, and the work hub, the applied
 *   commands, the calls served for a Host, the Devices online and the
 *   pairings in progress go on).
 *
 * The names stay as they are: a running dev daemon reloads into new code
 * with the same names.
 *
 * The kept documents are Yjs documents. A reload evaluates Yjs again too,
 * so the dev entry's preload (`apps/server/src/hot-preload.ts`) gives every
 * reload the one Yjs of the process: the new code reads them as its own.
 */
export type HotRegistry = KeptDevices &
	KeptSync & {
		/** The database clients of this process, by URL (`processDatabase`). */
		nightshiftDatabases?: Map<string, Database>;
		nightshiftLease?: Lease;
		/** Every document this Replica syncs, by name. */
		nightshiftDocuments?: SyncedDocuments;
		/** A daemon of an older version kept these apart (`stopOlderDocuments`). */
		nightshiftDocument?: OlderDocuments;
		nightshiftSpaces?: OlderDocuments;
		nightshiftFlows?: OlderDocuments;
		nightshiftKnowledgeDocuments?: OlderDocuments;
		nightshiftInApp?: InAppChannel;
		nightshiftNotifications?: Notifications;
		nightshiftKeepAwake?: KeepAwake;
		/** The export to monitoring: its providers stop with it. */
		nightshiftTelemetry?: Telemetry;
		nightshiftScheduler?: AbortController;
		/** The clones from GitHub that run, and how the last ones ended. */
		nightshiftGitHubClones?: GitHubClones;
		nightshiftKnowledgeSearch?: KnowledgeSearch;
		/** The Ollama Night Shift uses: the `ollama serve` it started stops with it. */
		nightshiftOllama?: OllamaService;
		nightshiftProjectCopies?: ProjectCopies;
		/** The daily update of the price list. */
		nightshiftPrices?: PriceUpdates;
		nightshiftFacts?: Timer;
		/**
		 * The first reconcile of every knowledge folder, the retry of what
		 * waits for a Host, and the collection of old content. A daemon of
		 * an older version kept no collection timers.
		 */
		nightshiftKnowledgeTimers?: {
			first: Timer;
			retry: Timer;
			firstCollect?: Timer;
			collect?: Timer;
		};
		/** The stop of the newest daemon: the signal handlers call it. */
		nightshiftStop?: () => Promise<void>;
	};

export const hot = globalThis as HotRegistry;

/** Documents a daemon of an older version kept, one slot per kind. */
type OlderDocuments = { close?(): Promise<void> };

/**
 * A daemon of an older version kept the Device, Space, flow and
 * knowledge documents in a slot each. The first daemon with one slot for
 * every document closes them: each document keeps one writer in the
 * process. A connection the relay kept still holds the older documents:
 * restart the daemon after such a reload.
 */
export async function stopOlderDocuments(registry: HotRegistry) {
	const names = [
		"nightshiftDocument",
		"nightshiftSpaces",
		"nightshiftFlows",
		"nightshiftKnowledgeDocuments",
	] as const;
	for (const name of names) {
		const older = registry[name];
		registry[name] = undefined;
		await older?.close?.().catch((error) => {
			console.error(`${name} did not stop cleanly:`, error);
		});
	}
}

type Value<R, K extends keyof R> = NonNullable<R[K]>;

/**
 * The slots one daemon uses, each with its lifecycle across `bun --hot`
 * reloads. Every daemon names its slots again, so the newest daemon's
 * `stop` knows them all.
 */
export type HotSlots<R extends object> = {
	/**
	 * Kept as it is: made on the first start of the process, the same on
	 * every reload. `close` runs when the daemon stops.
	 */
	keep<K extends keyof R>(
		name: K,
		make: () => Value<R, K> | Promise<Value<R, K>>,
		close?: (value: Value<R, K>) => unknown,
	): Promise<Value<R, K>>;
	/**
	 * Replaced on each start: the one before stops first, then `make`
	 * makes this one. `stop` also runs when the daemon stops.
	 */
	replace<K extends keyof R>(
		name: K,
		make: () => Value<R, K> | Promise<Value<R, K>>,
		stop: (value: Value<R, K>) => unknown,
	): Promise<Value<R, K>>;
	/**
	 * Filled by the module it belongs to, which hands it over on a reload
	 * itself (`startDevices`). `release` runs when the daemon stops.
	 */
	handOver<K extends keyof R>(
		name: K,
		release: (value: Value<R, K>) => unknown,
	): void;
	/**
	 * Stops the slots, then empties them: a next start in this process
	 * begins fresh. First the replaced slots stop, so nothing new starts or
	 * writes. Then the kept slots close (the documents write what they
	 * still have pending, the lease goes) while the handed-over slots let
	 * go: an engine that waits for its writes in flight does not hold the
	 * documents up. Never throws.
	 */
	stop(): Promise<void>;
};

/** The lifecycle of each slot of `store`: in the daemon, the registry (`hot`). */
export function hotSlots<R extends object>(store: R): HotSlots<R> {
	type Ending = { name: keyof R; end: (value: never) => unknown };
	const kept: Ending[] = [];
	const replaced: Ending[] = [];
	const handedOver: Ending[] = [];
	const slots = store as Record<keyof R, unknown>;

	/** Ends the slots of `endings` that hold a value, and empties them. */
	const end = (endings: readonly Ending[]) =>
		Promise.all(
			endings.map(async ({ name, end }) => {
				const value = slots[name];
				slots[name] = undefined;
				if (value === undefined || value === null) return;
				try {
					await end(value as never);
				} catch (error) {
					console.error(`${String(name)} did not stop cleanly:`, error);
				}
			}),
		);

	return {
		async keep(name, make, close) {
			if (close) kept.push({ name, end: close });
			slots[name] ??= await make();
			return slots[name] as Value<R, typeof name>;
		},
		async replace(name, make, stop) {
			replaced.push({ name, end: stop });
			const before = slots[name] as Value<R, typeof name> | undefined;
			slots[name] = undefined;
			if (before !== undefined && before !== null) await stop(before);
			const value = await make();
			slots[name] = value;
			return value;
		},
		handOver(name, release) {
			handedOver.push({ name, end: release });
		},
		async stop() {
			await end(replaced);
			await Promise.all([end(kept), end(handedOver)]);
		},
	};
}
