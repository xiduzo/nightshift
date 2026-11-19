import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { createLeaseKeeper, createLeaseStore } from "../../../../leases";
import { inMemoryRunLeases } from "./in-memory-run-leases";
import { keeperRunLeases } from "./keeper-run-leases";
import { runLeasesContract } from "./run-leases.contract";

/**
 * The contract of `RunLeases`, on both adapters. The real side is the
 * lease keeper over the lease store of a Space this Replica keeps, on
 * libsql in memory.
 */

runLeasesContract("in memory", async () => {
	const leases = inMemoryRunLeases();
	return {
		leases,
		take: async (runId, name) => leases.take(runId, name),
		close: async () => {},
	};
});

runLeasesContract(
	"over the lease keeper and its store, on libsql in memory",
	async () => {
		const db = createDb({ DATABASE_URL: ":memory:" });
		await migrateDb(db);
		const store = createLeaseStore({ db, now: () => 1_000_000 });
		const keeper = createLeaseKeeper({
			db,
			store,
			hostedElsewhere: async () => false,
			walkerId: async () => "device-here",
			minuteMs: 60_000,
		});
		return {
			leases: keeperRunLeases(keeper),
			async take(runId, name) {
				const run = { id: runId, spaceId: "space-1", title: runId };
				return (await keeper.take(run, { name })).kind === "held";
			},
			close: async () => {},
		};
	},
);
