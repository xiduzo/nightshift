import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { project } from "@nightshift/db/schema";
import type { RunStreamItem } from "@nightshift/engine";
import {
	createRunLog,
	createSandbox,
	type Sandbox,
	waitFor,
} from "@nightshift/engine/testing";
import type { Flow } from "@nightshift/flows";
import { eq } from "drizzle-orm";
import { createPeerEngine, type PeerEngine } from "../peers";
import { withPeers } from "../testing";

/**
 * The run page of a run walked elsewhere, in one process: A walks a run
 * in a Space B keeps (B is its Host), B's `watchRun` shows the running
 * step's output as A writes it, before the step ends. The link is a fake:
 * B's demand reaches A's pumps, and A's pumps push into B.
 */

let a: Sandbox;
let b: Sandbox;
beforeEach(async () => {
	[a, b] = await Promise.all([createSandbox(), createSandbox()]);
});
afterEach(async () => {
	await Promise.all([a.cleanup(), b.cleanup()]);
});

function engineOf(sandbox: Sandbox): PeerEngine {
	return createPeerEngine(
		withPeers({
			db: sandbox.db,
			harnesses: {},
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			scheduler: false,
		}),
		{ runLog: createRunLog(sandbox.db) },
	);
}

/** One command that prints, waits for a file, and prints again. */
function slowFlow(marker: string): Flow {
	return {
		version: 5,
		inputs: [],
		outputs: [],
		start: "build",
		nodes: [
			{
				id: "build",
				type: "command",
				position: { x: 0, y: 0 },
				command: `echo first; while [ ! -f '${marker}' ]; do sleep 0.05; done; echo second`,
				output: "text",
			},
		],
		edges: [],
	} as Flow;
}

/** Everything of A's Walker in A's Space, into B. */
async function exchange(engineA: PeerEngine, engineB: PeerEngine) {
	const cursors = await engineB.exchange.rows.cursorsWith("a");
	const { rows, cursors: moved } = await engineA.exchange.rows.rowsAfter({
		spaces: [a.spaceId],
		cursors,
		except: b.deviceId,
	});
	await engineB.exchange.rows.ingest(rows);
	await engineB.exchange.rows.advance("a", moved);
}

const outputOf = (items: RunStreamItem[]) =>
	items.flatMap((item) =>
		item.kind === "transcript" && item.entry.event.type === "command-output"
			? [item.entry.event.text.trim()]
			: [],
	);

describe("watching a run walked elsewhere", () => {
	test("shows the running step's output live, and stops the Walker when nobody watches", async () => {
		const engineA = engineOf(a);
		const engineB = engineOf(b);
		const { id: projectId } = await engineA
			.space(a.spaceId)
			.addProject({ repoPath: a.repoPath });
		const [row] = await a.db
			.select()
			.from(project)
			.where(eq(project.id, projectId));
		await b.db.insert(project).values(row as typeof project.$inferInsert);

		// The fake link between A (the Walker) and B (its Host).
		const pushed: number[] = [];
		const pumps = engineA.exchange.feeds.pumps(async (step, entries, ended) => {
			pushed.push(...entries.map((e) => e.seq));
			engineB.exchange.feeds.deliver(a.deviceId, step, entries, ended);
		});
		const stopDemand = engineB.exchange.feeds.onWanted(a.deviceId, () =>
			queueMicrotask(() =>
				pumps.set(engineB.exchange.feeds.wanted(a.deviceId)),
			),
		);

		const marker = join(a.dataDir, "go");
		const run = await engineA
			.space(a.spaceId)
			.startRun({ projectId, flow: slowFlow(marker) });
		// The step runs on A and has printed its first line.
		await waitFor(async () => {
			const steps = (await engineA.space(a.spaceId).getRun(run.id)).steps;
			return steps.some((s) => s.endedAt === null);
		});
		await exchange(engineA, engineB);
		expect(pushed).toEqual([]);

		const controller = new AbortController();
		const items: RunStreamItem[] = [];
		const watching = (async () => {
			for await (const item of engineB
				.space(a.spaceId)
				.watchRun(run.id, { signal: controller.signal })) {
				items.push(item);
			}
		})();

		await waitFor(() => outputOf(items).includes("first"), {
			label: "the first line on B",
		});
		// Still running: nothing of the step's end reached B.
		const onB = await engineB.space(a.spaceId).getRun(run.id);
		expect(onB.steps[0]?.endedAt).toBeNull();

		// The step goes on and ends; its last line comes live too.
		await Bun.write(marker, "");
		await waitFor(() => outputOf(items).includes("second"), {
			label: "the second line on B",
		});
		expect(outputOf(items)).toEqual(["first", "second"]);
		await waitFor(
			async () =>
				(await engineA.space(a.spaceId).getRun(run.id)).status === "finished",
		);

		// Nobody watches: B wants nothing from A any more.
		controller.abort();
		await watching;
		await waitFor(() => engineB.exchange.feeds.wanted(a.deviceId).length === 0);
		stopDemand();
		pumps.close();
	});
});
