import { describe, expect, test } from "bun:test";
import { createDb } from "@nightshift/db";
import { project, run } from "@nightshift/db/schema";
import { migratedDb } from "@nightshift/db/testing";
import { Refusal, type RefusalKind } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import { NotOnThisComputer, type StartRunInput } from "../../../../contract";
import { createRunLog } from "../../../../log";
import type { RunSummary } from "../../../../read";
import { ownDevice } from "../../../../testing/alone-directory";
import { appendEvent } from "../../../../testing/append-event";
import { localSpaceId } from "../../../../testing/test-support";
import { hostStartsContract } from "./host-starts.contract";
import { inMemoryHostStarts } from "./in-memory-host-starts";
import { relayHostStarts } from "./relay-host-starts";

/** The refusal of a Host, as a Link brings it: its kind and its words, never its class. */
const overALink = (kind: RefusalKind, words: string) =>
	new Refusal(kind, words, { cause: new Error("The answer of the Host.") });

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
		const db = await migratedDb();
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

describe("the refusal of a Host, over its Link", () => {
	const START = {
		projectId: "project-1",
		flowName: "watch",
		spaceId: "space-1",
	};
	/** What a start throws when the Host refuses it with `refusal`. */
	async function refused(refusal: Error): Promise<unknown> {
		const db = await migratedDb();
		return relayHostStarts({
			db,
			log: createRunLog(db, { walkerId: "here", dataDir: "/nowhere" }),
			relay: { startRun: () => Promise.reject(refusal) },
			now,
			listRuns: async () => [],
		})
			.start(START)
			.catch((error: unknown) => error);
	}

	test("a Host without a Clone of the project says so by its words: the start throws NotOnThisComputer", async () => {
		const { kind, message } = new NotOnThisComputer();
		const answer = overALink(kind, message);
		const error = await refused(answer);
		expect(error).toBeInstanceOf(NotOnThisComputer);
		expect(error).toMatchObject({ kind, message, cause: answer });
	});

	test("every other refusal is as the Host gave it", async () => {
		const other = overALink("conflict", "Too many runs.");
		expect(await refused(other)).toBe(other);
		const otherKind = overALink("unavailable", new NotOnThisComputer().message);
		expect(await refused(otherKind)).toBe(otherKind);
		const failed = new Error(new NotOnThisComputer().message);
		expect(await refused(failed)).toBe(failed);
	});
});
