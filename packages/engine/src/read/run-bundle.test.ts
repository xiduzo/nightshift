import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fakeHarness, reportingScript } from "@nightshift/agents/testing";
import { createDb } from "@nightshift/db";
import { event, run, step } from "@nightshift/db/schema";
import type { AgentNode, CommandNode, Flow } from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { asc, eq, sql } from "drizzle-orm";
import { NIGHT_SHIFT } from "../contract";
import { foldRun } from "../log";
import { parseEventRow } from "../log/run-log/append";
import { readRunTranscript } from "../log/transcript/transcripts";
import { openRunBundle } from "../testing/run-bundle";
import { createTestEngine } from "../testing/test-engine";
import {
	createSandbox,
	otherSpace,
	type Sandbox,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { exportRun } from "./run-bundle";
import { deriveNodeOutputs, deriveSteps, sumCost } from "./run-views";

const SECRET = "sk-test-0123456789";

let sandbox: Sandbox;
beforeEach(async () => {
	sandbox = await createSandbox();
});
afterEach(async () => {
	await sandbox.cleanup();
});

const work: AgentNode = {
	id: "work",
	type: "agent",
	position: { x: 0, y: 0 },
	prompt: "Fix it.",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
	session: "fresh",
};
const check: CommandNode = {
	id: "check",
	type: "command",
	position: { x: 0, y: 0 },
	command: "echo checked",
	stdout: "text",
};
const flow: Flow = {
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: "work",
	nodes: [work, check],
	edges: [{ id: "e1", from: "work", outcome: "pass", to: "check" }],
};

/** A finished run of agent → command. The agent read a file that held a secret. */
async function finishedRun(): Promise<string> {
	const script = reportingScript("pass", "Fixed.");
	const engine = createTestEngine(
		withDevice({
			db: sandbox.db,
			harnesses: {
				"claude-code": fakeHarness({
					...script,
					steps: [
						{ type: "tool", name: "Read", result: `TOKEN=${SECRET}` },
						...(script.steps ?? []),
					],
					outcome: {
						type: "finished",
						usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.25 },
					},
				}),
			},
			dataDir: sandbox.dataDir,
		}),
	).space(sandbox.spaceId, NIGHT_SHIFT);
	const { id: projectId } = await engine.addProject({
		repoPath: sandbox.repoPath,
	});
	const started = await engine.startRun({ projectId, flow });
	await waitFor(
		async () => (await engine.getRun(started.id)).status === "finished",
		{ label: "the run to finish" },
	);
	return started.id;
}

async function liveEvents(runId: string) {
	const rows = await sandbox.db
		.select()
		.from(event)
		.where(eq(event.runId, runId))
		.orderBy(asc(event.seq));
	return rows.map(parseEventRow);
}

async function liveSteps(runId: string) {
	return sandbox.db.select().from(step).where(eq(step.runId, runId));
}

describe("exportRun", () => {
	test("writes the run's rows, events and transcript lines to one small file", async () => {
		const runId = await finishedRun();
		const path = join(sandbox.root, "run.nightshift.sqlite");
		const summary = await exportRun({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			runId,
			spaceId: sandbox.spaceId,
			path,
		});
		expect(summary).toMatchObject({ path, runId, missingTranscripts: [] });

		const file = createDb(
			{ DATABASE_URL: `file:${path}` },
			{ singleFile: true },
		);
		const tables = await file.all<{ name: string }>(
			sql`select name from sqlite_master where type = 'table' order by name`,
		);
		expect(tables.map((t) => t.name)).toEqual([
			"agent_session",
			"bundle",
			"clone",
			"event",
			"project",
			"run",
			"step",
			"transcript",
		]);
		const count = async (table: string) =>
			(
				await file.all<{ n: number }>(
					sql.raw(`select count(*) as n from ${table}`),
				)
			)[0]?.n;
		expect(await count("run")).toBe(1);
		expect(await count("project")).toBe(1);
		expect(await count("clone")).toBe(1);
		expect(await count("step")).toBe(2);
		expect(await count("agent_session")).toBe(1);
		expect(await count("event")).toBe((await liveEvents(runId)).length);

		const steps = await liveSteps(runId);
		const lines = (
			await Promise.all(
				steps.map(async (s) =>
					(await readFile(s.transcriptPath, "utf8")).trim().split("\n"),
				),
			)
		).flat();
		expect(await count("transcript")).toBe(lines.length);

		const [freelist] = await file.all<{ freelist_count: number }>(
			sql`pragma freelist_count`,
		);
		expect(freelist?.freelist_count).toBe(0);
		file.$client.close();
		// No settings, connections, secrets or auth tables; no journal left behind.
		expect(statSync(path).size).toBeLessThan(128 * 1024);
		expect(existsSync(`${path}-wal`)).toBe(false);
		expect(existsSync(`${path}-journal`)).toBe(false);
	});

	test("a round trip derives the same status, steps, outputs and cost", async () => {
		const runId = await finishedRun();
		const path = join(sandbox.root, "run.nightshift.sqlite");
		await exportRun({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			runId,
			spaceId: sandbox.spaceId,
			path,
		});
		const live = await liveEvents(runId);

		const opened = await openRunBundle(path);
		expect(opened.meta).toMatchObject({
			formatVersion: 10,
			runId,
			missingTranscripts: [],
			redacted: 0,
		});
		expect(opened.meta.schema).toEqual(expect.any(String));
		expect(opened.run.id).toBe(runId);
		expect(opened.run.deviceId).toBe(
			(await sandbox.db.select().from(run).where(eq(run.id, runId)))[0]
				?.deviceId ?? "missing",
		);
		expect(opened.run.spaceId).toBe(sandbox.spaceId);
		expect(opened.clones[0]?.path).toBe(sandbox.repoPath);
		expect(opened.events).toEqual(live);
		expect(foldRun(opened.events).end).toEqual(foldRun(live).end);
		expect(foldRun(opened.events).status).toBe("finished");
		expect(deriveSteps(foldRun(opened.events))).toEqual(
			deriveSteps(foldRun(live)),
		);
		expect(deriveNodeOutputs(foldRun(opened.events), "")).toEqual(
			deriveNodeOutputs(foldRun(live), ""),
		);
		expect(sumCost(foldRun(opened.events)).usd).toBe(0.25);
		expect(await opened.transcript()).toEqual(
			await readRunTranscript(
				(await liveSteps(runId)).map((s) => s.transcriptPath),
			),
		);
		// Without `redact`, the transcript keeps what the agent read.
		expect(JSON.stringify(await opened.transcript())).toContain(SECRET);
		const agentStep = opened.steps.find((s) => s.nodeId === "work");
		expect(
			(await opened.transcript(agentStep?.id)).every(
				(e) => e.stepId === agentStep?.id,
			),
		).toBe(true);
		opened.close();
	});

	test("a run of another Space is not exported", async () => {
		const runId = await finishedRun();
		const path = join(sandbox.root, "run.nightshift.sqlite");
		expect(
			await exportRun({
				db: sandbox.db,
				dataDir: sandbox.dataDir,
				runId,
				spaceId: await otherSpace(sandbox.db),
				path,
			}),
		).toBeNull();
		expect(existsSync(path)).toBe(false);
	});

	test("a missing transcript file is noted, not an error", async () => {
		const runId = await finishedRun();
		const steps = await liveSteps(runId);
		const gone = steps.find((s) => s.nodeId === "check");
		if (!gone) throw new Error("no check step");
		await rm(gone.transcriptPath);
		// A torn last line is left out too.
		const kept = steps.find((s) => s.nodeId === "work");
		if (!kept) throw new Error("no work step");
		await writeFile(
			kept.transcriptPath,
			`${await readFile(kept.transcriptPath, "utf8")}{"seq":`,
		);

		const path = join(sandbox.root, "run.nightshift.sqlite");
		const summary = await exportRun({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			runId,
			spaceId: sandbox.spaceId,
			path,
		});
		expect(summary?.missingTranscripts).toEqual([gone.id]);

		const opened = await openRunBundle(path);
		expect(opened.meta.missingTranscripts).toEqual([gone.id]);
		expect(await opened.transcript(gone.id)).toEqual([]);
		expect((await opened.transcript()).length).toBeGreaterThan(0);
		expect(opened.steps).toHaveLength(2);
		opened.close();
	});

	test("reads each transcript in this computer's data folder, also when its row names another (a run moved here)", async () => {
		const runId = await finishedRun();
		// The rows a run moved here keeps name its old Walker's folder.
		for (const s of await liveSteps(runId)) {
			await sandbox.db
				.update(step)
				.set({ transcriptPath: join("/elsewhere", `${s.id}.ndjson`) })
				.where(eq(step.id, s.id));
		}
		const path = join(sandbox.root, "run.nightshift.sqlite");
		const summary = await exportRun({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			runId,
			spaceId: sandbox.spaceId,
			path,
		});
		expect(summary?.missingTranscripts).toEqual([]);
		const opened = await openRunBundle(path);
		expect((await opened.transcript()).length).toBeGreaterThan(0);
		opened.close();
	});

	test("secret values become ••• and every line still parses", async () => {
		const runId = await finishedRun();
		const path = join(sandbox.root, "run.nightshift.sqlite");
		await exportRun({
			db: sandbox.db,
			dataDir: sandbox.dataDir,
			runId,
			spaceId: sandbox.spaceId,
			path,
			// Too short to take out safely: left alone.
			redact: [SECRET, "Fix"],
		});
		const bytes = await readFile(path);
		expect(bytes.includes(SECRET)).toBe(false);

		const opened = await openRunBundle(path);
		expect(opened.meta.redacted).toBeGreaterThan(0);
		const text = JSON.stringify(await opened.transcript());
		expect(text).toContain("TOKEN=•••");
		expect(text).not.toContain(SECRET);
		expect(opened.sessions[0]?.prompt).toContain("Fix it.");
		expect(foldRun(opened.events).status).toBe("finished");
		opened.close();
	});

	test("an unknown run gives null; an existing file is refused", async () => {
		const path = join(sandbox.root, "run.nightshift.sqlite");
		expect(
			await exportRun({
				db: sandbox.db,
				dataDir: sandbox.dataDir,
				runId: "nope",
				spaceId: sandbox.spaceId,
				path,
			}),
		).toBeNull();
		expect(existsSync(path)).toBe(false);

		const runId = await finishedRun();
		await writeFile(path, "");
		await expect(
			exportRun({
				db: sandbox.db,
				dataDir: sandbox.dataDir,
				runId,
				spaceId: sandbox.spaceId,
				path,
			}),
		).rejects.toThrow("already exists");
	});
});
