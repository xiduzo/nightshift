import { createDb } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { project, run } from "@nightshift/db/schema";
import { now } from "@nightshift/time";
import type { StartRunInput } from "../../../../contract";
import { createRunLog } from "../../../../log";
import { appendEvent } from "../../../../log/run-log/append";
import type { RunSummary } from "../../../../read";
import { ownDevice } from "../../../../testing/alone-directory";
import { localSpaceId } from "../../../../testing/test-support";
import { hostStartsContract } from "./host-starts.contract";
import { inMemoryHostStarts } from "./in-memory-host-starts";
import { relayHostStarts } from "./relay-host-starts";

/**
 * The contract of `HostStarts`, on both adapters. The real side runs on
 * libsql in memory: the rows the exchange brings are written by the test,
 * a Link to the Host is a recording one (the real Link is
 * `@nightshift/devices`), and it waits 300 ms for a run, not 30 s.
 */

hostStartsContract(
	"in memory",
	async () => {
		const hosts = inMemoryHostStarts();
		return {
			hosts,
			started: () => hosts.started,
			rowArrives: async () => {},
			eventArrives: async (runId) =>
				hosts.arrive(runId, { id: runId } as RunSummary),
			close: async () => {},
		};
	},
	() => {
		const hosts = inMemoryHostStarts();
		hosts.unreachable();
		return hosts;
	},
);

hostStartsContract(
	"over a Host's Link, on libsql in memory",
	async () => {
		const db = createDb({ DATABASE_URL: ":memory:" });
		await migrateDb(db);
		const walkerId = (await ownDevice(db)).id;
		const spaceId = await localSpaceId(db);
		await db
			.insert(project)
			.values({ id: "project-1", spaceId, name: "one", folder: false });
		const log = createRunLog(db, { walkerId, dataDir: "/nowhere" });
		const started: (StartRunInput & { spaceId: string })[] = [];
		/** The runs whose first event arrived: the run list shows them. */
		const listed = new Set<string>();
		return {
			hosts: relayHostStarts({
				db,
				log,
				relay: {
					startRun: async (input) => {
						started.push(input);
						return { runId: `run-on-host-${started.length}` };
					},
				},
				now,
				listRuns: async () => [...listed].map((id) => ({ id }) as RunSummary),
				arrivesWithinMs: 300,
			}),
			started: () => started,
			async rowArrives(runId) {
				await db.insert(run).values({
					id: runId,
					spaceId,
					projectId: "project-1",
					flow: "{}",
					title: "test",
					worktreePath: "",
					branch: "",
					baseRef: "",
					walkerId: "host-h",
				});
			},
			async eventArrives(runId) {
				await appendEvent(
					db,
					{
						runId,
						type: "RunStarted",
						payload: {
							projectId: "project-1",
							flowName: "watch",
							title: "watch",
							start: "a",
						},
					},
					"host-h",
				);
				// The exchange lands rows under the run log: it reads them again.
				log.forget([runId]);
				listed.add(runId);
			},
			close: async () => {},
		};
	},
	() =>
		relayHostStarts({
			db: createDb({ DATABASE_URL: ":memory:" }),
			log: { events: async () => [] },
			now,
			listRuns: async () => [],
		}),
);
