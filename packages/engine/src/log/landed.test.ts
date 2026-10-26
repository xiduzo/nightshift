import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "@nightshift/db";
import { event, project, run } from "@nightshift/db/schema";
import { eq, inArray } from "drizzle-orm";

import {
	createSandbox,
	otherSpace,
	type Sandbox,
	waitFor,
} from "../testing/test-support";
import type { EventInput } from "./events";
import {
	createLandedFeed,
	type LandedFeed,
	type LandedRunEvent,
} from "./landed";
import { createRunLog, type ForeignEvent, type RunLog } from "./run-log";

let sandbox: Sandbox;
let other: string;
let log: RunLog;
const feeds: LandedFeed[] = [];

beforeEach(async () => {
	sandbox = await createSandbox();
	other = await otherSpace(sandbox.db);
	await sandbox.db.insert(project).values([
		{ id: "p", spaceId: sandbox.spaceId, name: "p" },
		{ id: "q", spaceId: other, name: "q" },
	]);
	await sandbox.db.insert(run).values(
		[
			["a", sandbox.spaceId, "p"],
			["b", other, "q"],
		].map(([id, spaceId, projectId]) => ({
			id: id as string,
			spaceId: spaceId as string,
			projectId: projectId as string,
			flow: "{}",
			title: id as string,
			worktreePath: "/w",
			branch: "b",
			baseRef: "main",
			walkerId: sandbox.deviceId,
		})),
	);
	log = createRunLog(sandbox.db, { walkerId: sandbox.deviceId });
});
afterEach(async () => {
	for (const feed of feeds.splice(0)) feed.close();
	await sandbox.cleanup();
});

function feedOf(db: Database = sandbox.db): LandedFeed {
	const feed = createLandedFeed({ db, log });
	feeds.push(feed);
	return feed;
}

/** Counts the statements `db` runs from now on. */
function countStatements(db: Database): () => number {
	const client = db.$client;
	let count = 0;
	const execute = client.execute.bind(client);
	const batch = client.batch.bind(client);
	client.execute = ((...args: Parameters<typeof execute>) => {
		count += 1;
		return execute(...args);
	}) as typeof client.execute;
	client.batch = ((...args: Parameters<typeof batch>) => {
		count += args[0].length;
		return batch(...args);
	}) as typeof client.batch;
	return () => count;
}

const edge = (runId: string, n: number): EventInput<"EdgeTaken"> => ({
	type: "EdgeTaken",
	runId,
	payload: { edgeId: `e${n}`, from: "a", to: "b", outcome: "pass" },
});

/** Another Walker's event of run `b`, as the exchange brings it. */
const foreign = (walkerSeq: number): ForeignEvent => ({
	spaceId: other,
	runId: "b",
	stepId: null,
	sessionId: null,
	type: "EdgeTaken",
	payload: JSON.stringify({ edgeId: "x", from: "a", to: "b", outcome: "pass" }),
	at: Date.now(),
	walkerId: "walker-elsewhere",
	walkerSeq,
});

describe("landed feed", () => {
	test("counts the events already in the log once, at the start", async () => {
		await log.append(edge("a", 1));
		await log.append(edge("a", 2));
		await log.append(edge("b", 3));
		const feed = feedOf();

		const walkers = await feed.walkersAfter([sandbox.spaceId, other], {});
		expect(walkers).toEqual([
			{
				spaceId: sandbox.spaceId,
				walkerId: sandbox.deviceId,
				after: 0,
				latest: 2,
			},
			{ spaceId: other, walkerId: sandbox.deviceId, after: 0, latest: 3 },
		]);
		expect(
			feed.hasAfter([sandbox.spaceId], {
				[sandbox.spaceId]: { [sandbox.deviceId]: 2 },
			}),
		).toBe(false);
		expect(
			feed.hasAfter([sandbox.spaceId], {
				[sandbox.spaceId]: { [sandbox.deviceId]: 1 },
			}),
		).toBe(true);
	});

	test("keeps the latest of each Space and Walker from each landing, with no query", async () => {
		const feed = feedOf();
		await feed.walkersAfter([], {});
		const statements = countStatements(sandbox.db);

		await log.append(edge("a", 1));
		await log.ingest([foreign(7), foreign(8)]);
		const appended = statements();

		const at = {
			[sandbox.spaceId]: { [sandbox.deviceId]: 1 },
			[other]: { "walker-elsewhere": 8 },
		};
		expect(feed.hasAfter([sandbox.spaceId, other], at)).toBe(false);
		expect(feed.hasAfter([other], { [other]: { "walker-elsewhere": 7 } })).toBe(
			true,
		);
		// Only the Walkers it allows.
		expect(feed.hasAfter([other], {}, { except: "walker-elsewhere" })).toBe(
			false,
		);
		expect(
			await feed.walkersAfter(
				[sandbox.spaceId, other],
				{},
				{ only: "walker-elsewhere" },
			),
		).toEqual([
			{ spaceId: other, walkerId: "walker-elsewhere", after: 0, latest: 8 },
		]);
		expect(statements()).toBe(appended);
	});

	test("tells a reader only the events of its Spaces and Walkers, with their Space", async () => {
		const feed = feedOf();
		const mine: LandedRunEvent[] = [];
		const elsewhere: LandedRunEvent[] = [];
		feed.subscribe((events) => mine.push(...events), {
			spaces: [sandbox.spaceId],
		});
		feed.subscribe((events) => elsewhere.push(...events), {
			except: sandbox.deviceId,
		});

		await log.append(edge("a", 1));
		await log.append(edge("b", 2));
		await log.ingest([foreign(1)]);
		await log.append({
			type: "ProjectRenamed",
			payload: { projectId: "p", name: "renamed" },
		});

		expect(mine.map((e) => [e.runId, e.spaceId, e.walkerId])).toEqual([
			["a", sandbox.spaceId, sandbox.deviceId],
		]);
		expect(elsewhere.map((e) => [e.runId, e.spaceId, e.walkerSeq])).toEqual([
			["b", other, 1],
		]);
	});

	test("counts a moved project's events in its new Space", async () => {
		await log.append(edge("a", 1));
		await log.append(edge("a", 2));
		const feed = feedOf();
		await feed.walkersAfter([], {});

		// What `projects.move` does: the rows take the new Space, then the fact.
		await sandbox.db
			.update(event)
			.set({ spaceId: other })
			.where(inArray(event.runId, ["a"]));
		await sandbox.db
			.update(project)
			.set({ spaceId: other })
			.where(eq(project.id, "p"));
		await log.append({
			type: "ProjectMoved",
			payload: { projectId: "p", from: sandbox.spaceId, to: other },
		});

		expect(
			await feed.walkersAfter([sandbox.spaceId, other], {
				[other]: { [sandbox.deviceId]: 0 },
			}),
		).toEqual([
			{ spaceId: other, walkerId: sandbox.deviceId, after: 0, latest: 2 },
		]);
		await waitFor(
			() => (!feed.hasAfter([sandbox.spaceId], {}) ? true : undefined),
			{ label: "the counts read again" },
		);
	});

	test("stops telling once closed", async () => {
		const feed = feedOf();
		const told: LandedRunEvent[] = [];
		feed.subscribe((events) => told.push(...events));
		feed.close();
		await log.append(edge("a", 1));
		expect(told).toEqual([]);
	});
});
