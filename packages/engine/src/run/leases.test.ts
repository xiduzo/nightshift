import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentHarness } from "@nightshift/agents/types";
import { runLease } from "@nightshift/db/schema";
import type {
	AgentNode,
	Flow,
	FlowEdge,
	FlowNode,
	LeaseNode,
	WaitNode,
} from "@nightshift/flows";
import { FLOW_VERSION } from "@nightshift/flows";
import { instant, now } from "@nightshift/time";
import { HostUnreachableError, type Relay } from "../contract";
import {
	defaultRunSettings,
	type RunSettings,
} from "../device-config/settings";
import { createLeaseStore } from "../leases";
import { createRunLog, type RunLog } from "../log/run-log";
import type { RunDetail } from "../read/views";
import { aloneDirectory } from "../testing/alone-directory";
import { alonePeers } from "../testing/alone-peers";
import {
	createSandbox,
	expectRunLogsInSync,
	type Sandbox,
	scriptedHarness,
	type TestEngineOptions,
	waitFor,
	withDevice,
} from "../testing/test-support";
import { createEngine, type Engine, type EngineInternals } from "./engine";
import type { PeersFactory } from "./peers";
import type { SpaceEngine } from "./space-engine";

/**
 * Leases through the engine's public seam (ADR 7): two runs that contend
 * for one name, and the engine letting go of a lease on every end of a
 * run. A minute lasts 20 ms here.
 */

const MINUTE_MS = 20;

let sandbox: Sandbox;
let runLogs: RunLog[];
beforeEach(async () => {
	sandbox = await createSandbox();
	runLogs = [];
});
afterEach(async () => {
	try {
		await expectRunLogsInSync(sandbox.db, runLogs);
	} finally {
		await sandbox.cleanup();
	}
});

function makeEngine(
	harness: AgentHarness = scriptedHarness().harness,
	options: Pick<TestEngineOptions, "settings"> = {},
	internals: EngineInternals = {},
): SpaceEngine {
	const runLog = createRunLog(sandbox.db, {
		walkerId: sandbox.deviceId,
		dataDir: sandbox.dataDir,
	});
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": harness },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			...options,
		}),
		{ runLog, minuteMs: MINUTE_MS, ...internals },
	).space(sandbox.spaceId);
}

const at = { x: 0, y: 0 };
const lease = (extra: Partial<LeaseNode> = {}): LeaseNode => ({
	id: "own",
	type: "lease",
	position: at,
	name: "zac-docker-stack",
	...extra,
});
const waitFor_ = (name: string): WaitNode => ({
	id: "hold",
	type: "wait",
	position: at,
	until: { kind: "signal", name },
});
const edge = (from: string, outcome: string, to: string): FlowEdge => ({
	id: `${from}-${outcome}`,
	from,
	outcome,
	to,
});
const flowOf = (nodes: FlowNode[], edges: FlowEdge[]): Flow => ({
	version: FLOW_VERSION,
	inputs: [],
	outputs: [],
	start: nodes[0]?.id ?? "",
	nodes,
	edges,
});

/** An Agent step whose harness the test drives. */
const work: AgentNode = {
	id: "work",
	type: "agent",
	position: at,
	prompt: "Go",
	harness: "claude-code",
	model: "sonnet",
	permissionMode: "acceptEdits",
	session: "fresh",
};

/** Takes the lease, then holds it until the run gets the signal `go`. */
const holdingFlow = (extra: Partial<LeaseNode> = {}) =>
	flowOf([lease(extra), waitFor_("go")], [edge("own", "held", "hold")]);

/** Takes the lease, and ends `nothing-to-do` when another run holds it. */
const politeFlow = (extra: Partial<LeaseNode> = {}) =>
	flowOf(
		[
			lease(extra),
			{
				id: "done",
				type: "end",
				position: at,
				status: "done",
				message: "Took it",
			},
			{
				id: "skip",
				type: "end",
				position: at,
				status: "nothing-to-do",
				message: "{{own.holder_title}} holds the stack",
			},
		],
		[edge("own", "held", "done"), edge("own", "busy", "skip")],
	);

async function projectId(engine: SpaceEngine): Promise<string> {
	return (await engine.addProject({ repoPath: sandbox.repoPath })).id;
}

async function statusOf(engine: SpaceEngine, runId: string, status: string) {
	return waitFor(
		async () => {
			const detail = await engine.getRun(runId);
			return detail.status === status ? detail : null;
		},
		{ label: `run ${runId} to be ${status}` },
	);
}

async function endOf(engine: SpaceEngine, runId: string): Promise<RunDetail> {
	return waitFor(
		async () => {
			const detail = await engine.getRun(runId);
			return ["running", "sleeping", "waiting"].includes(detail.status)
				? null
				: detail;
		},
		{ label: "the run to end" },
	);
}

/** The run that holds each lease of the Space at `at`: now, or the engine's clock. */
async function holders(at = now()): Promise<Record<string, string>> {
	const rows = await sandbox.db.select().from(runLease);
	return Object.fromEntries(
		rows
			.filter((row) => instant(row.expiresAt) > at)
			.map((row) => [row.name, row.runId]),
	);
}

/** When the lease expires unless its run renews it. 0 when no run holds it. */
async function expiryOf(name = "zac-docker-stack"): Promise<number> {
	const rows = await sandbox.db.select().from(runLease);
	const row = rows.find((lease) => lease.name === name);
	return row ? instant(row.expiresAt) : 0;
}

/** Starts a run that takes the lease and sleeps holding it. */
async function holdingRun(
	engine: SpaceEngine,
	flow = holdingFlow(),
	clock: () => number = now,
) {
	const run = await engine.startRun({
		projectId: await projectId(engine),
		flow,
	});
	await statusOf(engine, run.id, "sleeping");
	expect(await holders(clock())).toEqual({ "zac-docker-stack": run.id });
	return run;
}

describe("two runs and one lease", () => {
	test("given a run that holds the lease, when another run takes it without a wait, then it ends nothing-to-do and names the holder", async () => {
		const engine = makeEngine();
		const first = await holdingRun(engine);
		const second = await engine.startRun({
			projectId: await projectId(engine),
			flow: politeFlow(),
		});
		const ended = await endOf(engine, second.id);
		expect(ended.status).toBe("finished");
		expect(ended.result).toBe("nothing-to-do");
		expect(ended.steps[0]?.outputs).toMatchObject({
			holder: first.id,
			holder_title: first.title,
		});
		expect(await holders()).toEqual({ "zac-docker-stack": first.id });
	});

	test("given a run that waits for the lease, when the holder ends, then the waiting run takes it at once", async () => {
		const engine = makeEngine();
		const first = await holdingRun(engine);
		const second = await engine.startRun({
			projectId: await projectId(engine),
			flow: politeFlow({ waitMinutes: 1_000 }),
		});
		await statusOf(engine, second.id, "sleeping");
		await engine.act(first.id, { kind: "signal", name: "go" });
		expect((await endOf(engine, first.id)).status).toBe("finished");
		const ended = await endOf(engine, second.id);
		expect(ended.result).toBe("done");
		expect(await holders()).toEqual({});
	});
});

describe("the engine lets go of a lease on every end", () => {
	test("given a run that holds the lease, when it ends done, then the lease is free", async () => {
		const engine = makeEngine();
		const run = await holdingRun(engine);
		await engine.act(run.id, { kind: "signal", name: "go" });
		await endOf(engine, run.id);
		expect(await holders()).toEqual({});
	});

	test("given a run that holds the lease, when a person stops it, then the lease is free", async () => {
		const engine = makeEngine();
		const run = await holdingRun(engine);
		await engine.act(run.id, { kind: "stop" });
		expect((await endOf(engine, run.id)).status).toBe("stopped");
		expect(await holders()).toEqual({});
	});

	test("given a run that holds the lease, when a step fails, then the lease is free", async () => {
		const engine = makeEngine();
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					lease(),
					{
						id: "check",
						type: "command",
						position: at,
						command: "exit 3",
						stdout: "text",
					},
				],
				[edge("own", "held", "check")],
			),
		});
		expect((await endOf(engine, run.id)).status).toBe("failed");
		expect(await holders()).toEqual({});
	});

	test("given a run the daemon died in, when it does not continue on its own, then the lease is free", async () => {
		const dying = scriptedHarness({ hang: true });
		const dies = new AbortController();
		const first = makeEngine(dying.harness, {}, { signal: dies.signal });
		const run = await first.startRun({
			projectId: await projectId(first),
			flow: flowOf([lease(), work], [edge("own", "held", "work")]),
		});
		await waitFor(() => dying.sessions[0], { label: "the session" });
		dies.abort();
		expect(await holders()).toEqual({ "zac-docker-stack": run.id });

		const second = makeEngine(
			scriptedHarness().harness,
			{ settings: settingsWith({ resumeInterruptedRuns: false }) },
			{ resumeGraceMs: 0 },
		);
		expect((await second.getRun(run.id)).status).toBe("interrupted");
		await waitFor(async () => Object.keys(await holders()).length === 0, {
			label: "the lease to be free",
		});
	});

	test("given a run the daemon died in, when it continues on its own, then it keeps the lease", async () => {
		const dying = scriptedHarness({ hang: true });
		const dies = new AbortController();
		const first = makeEngine(dying.harness, {}, { signal: dies.signal });
		const run = await first.startRun({
			projectId: await projectId(first),
			flow: flowOf([lease(), work], [edge("own", "held", "work")]),
		});
		await waitFor(() => dying.sessions[0], { label: "the session" });
		dies.abort();

		const { harness, sessions } = scriptedHarness();
		const second = makeEngine(harness, {}, { resumeGraceMs: 0 });
		const resumed = await waitFor(() => sessions[0], { label: "the resume" });
		expect(await holders()).toEqual({ "zac-docker-stack": run.id });
		resumed.finish();
		expect((await endOf(second, run.id)).status).toBe("finished");
		expect(await holders()).toEqual({});
	});

	test("given a run the daemon died in, when its lease expired before a new daemon started, then the run takes the lease back when it continues", async () => {
		let at = now();
		// Real minutes: no renewal timer fires while the test runs.
		const clock = { now: () => at, minuteMs: 60_000 };
		const dying = scriptedHarness({ hang: true });
		const dies = new AbortController();
		const first = makeEngine(
			dying.harness,
			{},
			{ ...clock, signal: dies.signal },
		);
		const run = await first.startRun({
			projectId: await projectId(first),
			flow: flowOf(
				[lease({ ttlMinutes: 2 }), work],
				[edge("own", "held", "work")],
			),
		});
		await waitFor(() => dying.sessions[0], { label: "the session" });
		dies.abort();
		// No daemon runs for three minutes: the lease expires.
		at += 3 * 60_000;
		expect(await holders(at)).toEqual({});

		const { harness, sessions } = scriptedHarness();
		const ends = new AbortController();
		const second = makeEngine(
			harness,
			{},
			{ ...clock, resumeGraceMs: 0, signal: ends.signal },
		);
		try {
			const resumed = await waitFor(() => sessions[0], {
				label: "the resume",
			});
			expect(await holders(at)).toEqual({ "zac-docker-stack": run.id });
			resumed.finish();
			expect((await endOf(second, run.id)).status).toBe("finished");
		} finally {
			ends.abort();
		}
	});
});

const settingsWith = (patch: Partial<RunSettings>) => (): RunSettings => ({
	...defaultRunSettings(),
	...patch,
});

describe("a lease holds for its scope", () => {
	test("given a lease for a Section, when the run leaves the Section, then the lease is free while the run goes on", async () => {
		const engine = makeEngine();
		const run = await engine.startRun({
			projectId: await projectId(engine),
			flow: {
				...flowOf(
					[
						lease({ scope: { section: "deploy" } }),
						{
							id: "up",
							type: "command",
							position: at,
							command: "true",
							stdout: "text",
						},
						waitFor_("go"),
					],
					[edge("own", "held", "up"), edge("up", "pass", "hold")],
				),
				sections: [{ id: "deploy", label: "Deploy", nodes: ["own", "up"] }],
			},
		});
		await statusOf(engine, run.id, "sleeping");
		expect(await holders()).toEqual({});
		const events = await (runLogs[0] as RunLog).events(run.id);
		expect(
			events.flatMap((e) =>
				e.type === "LeaseTaken" || e.type === "LeaseReleased"
					? [[e.type, e.payload]]
					: [],
			),
		).toEqual([
			[
				"LeaseTaken",
				{
					name: "zac-docker-stack",
					nodeId: "own",
					ttlMinutes: 30,
					scope: null,
					section: { id: "deploy", nodes: ["own", "up"] },
				},
			],
			["LeaseReleased", { name: "zac-docker-stack", why: "scope" }],
		]);
	});
});

describe("a run that resumes takes its leases again", () => {
	test("given a failed run that held a lease, when another run holds it, then the resume is refused; once free, the run takes it again before its next step", async () => {
		const marker = `${sandbox.root}/go`;
		const engine = makeEngine();
		const first = await engine.startRun({
			projectId: await projectId(engine),
			flow: flowOf(
				[
					lease(),
					{
						id: "check",
						type: "command",
						position: at,
						command: `test -f ${marker}`,
						stdout: "text",
					},
				],
				[edge("own", "held", "check")],
			),
		});
		expect((await endOf(engine, first.id)).status).toBe("failed");
		expect(await holders()).toEqual({});

		const second = await holdingRun(engine);
		await expect(engine.act(first.id, { kind: "resume" })).rejects.toThrow(
			`holds the lease "zac-docker-stack" now. Resume this run when that run lets go of it.`,
		);
		expect((await engine.getRun(first.id)).status).toBe("failed");

		await engine.act(second.id, { kind: "signal", name: "go" });
		await endOf(engine, second.id);
		await Bun.write(marker, "");
		await engine.act(first.id, { kind: "resume" });
		expect((await endOf(engine, first.id)).status).toBe("finished");
		const events = await (runLogs[0] as RunLog).events(first.id);
		const types = events.map((e) => e.type);
		// Taken again before the resume, then the step ran.
		expect(types.lastIndexOf("LeaseTaken")).toBeLessThan(
			types.lastIndexOf("RunResumed"),
		);
		expect(
			events.filter((e) => e.type === "LeaseTaken").map((e) => e.payload),
		).toEqual([
			{ name: "zac-docker-stack", nodeId: "own", ttlMinutes: 30, scope: null },
			{
				name: "zac-docker-stack",
				nodeId: "own",
				ttlMinutes: 30,
				scope: null,
				again: true,
			},
		]);
		expect(await holders()).toEqual({});
	});
});

/**
 * The engines of these tests run on a clock that moves only when the test
 * moves it. A lease expires on that clock, so a busy machine that fires a
 * renewal late cannot let it expire.
 */
describe("after a restart", () => {
	test("given a run that sleeps holding a lease of 2 minutes, when a new daemon starts, then it renews the lease at once, not a minute later", async () => {
		let at = now();
		// Real minutes: no renewal timer fires while the test runs.
		const clock = { now: () => at, minuteMs: 60_000 };
		const dies = new AbortController();
		const first = makeEngine(undefined, {}, { ...clock, signal: dies.signal });
		const run = await holdingRun(
			first,
			holdingFlow({ ttlMinutes: 2 }),
			clock.now,
		);
		const firstExpiry = await expiryOf();
		// The first daemon dies a minute and a half after its last renewal.
		dies.abort();
		at += 90_000;
		const ends = new AbortController();
		const second = makeEngine(undefined, {}, { ...clock, signal: ends.signal });
		try {
			expect((await second.getRun(run.id)).status).toBe("sleeping");
			await waitFor(async () => (await expiryOf()) > firstExpiry, {
				label: "the new daemon to renew the lease",
			});
			// Past the first ttl, before the new daemon's first minute is up.
			at += 60_000;
			expect(await holders(at)).toEqual({ "zac-docker-stack": run.id });
		} finally {
			ends.abort();
		}
	});

	test("given a run that sleeps holding a short lease, when a new daemon starts, then it renews the lease every minute so it does not expire", async () => {
		let at = now();
		const clock = () => at;
		const dies = new AbortController();
		const first = makeEngine(
			undefined,
			{},
			{ now: clock, signal: dies.signal },
		);
		const run = await holdingRun(first, holdingFlow({ ttlMinutes: 2 }), clock);
		// The first daemon dies: its renewals go with it.
		dies.abort();
		const ends = new AbortController();
		const second = makeEngine(
			undefined,
			{},
			{ now: clock, signal: ends.signal },
		);
		try {
			expect((await second.getRun(run.id)).status).toBe("sleeping");
			// Five ttls later the lease is still the run's: the new daemon
			// renewed it each minute.
			for (let minute = 1; minute <= 10; minute++) {
				at += MINUTE_MS;
				await waitFor(async () => (await expiryOf()) >= at + 2 * MINUTE_MS, {
					label: `the renewal of minute ${minute}`,
				});
			}
			expect(await holders(at)).toEqual({ "zac-docker-stack": run.id });
		} finally {
			ends.abort();
		}
	});
});

/**
 * A Host that keeps the Space and its leases, behind a link the test
 * takes down and brings up. Its leases are a store over this database, on
 * the engine's clock, so `holders` and `expiryOf` read them. It walks no
 * run: a start asks whether it reaches the Host, and every run of the test
 * is walked here.
 */
function hostKeeping(clock: () => number) {
	const store = createLeaseStore({ db: sandbox.db, now: clock });
	const link = { up: true, renewals: 0 };
	const away = () => Promise.reject(new HostUnreachableError());
	const over = <T>(call: () => Promise<T>) => (link.up ? call() : away());
	const relay: Relay = {
		command: away,
		addProject: away,
		addWithoutFolder: away,
		addClone: away,
		startRun: away,
		reachable: async () => false,
		leases: {
			take: (take) => over(() => store.take(take)),
			renew(input) {
				link.renewals++;
				return over(() => store.renew(input));
			},
			release: (input) => over(() => store.release(input)),
		},
	};
	let keeps = false;
	const peers: PeersFactory = (context) => ({ ...alonePeers(context), relay });
	return {
		link,
		/** From now on the Host keeps the Space: its project is added before. */
		keep() {
			keeps = true;
		},
		peers,
		directory: {
			...aloneDirectory(sandbox.db),
			hostedElsewhere: async () => keeps,
			hostOf: async () => (keeps ? "host" : null),
		},
	};
}

/** An engine whose Space a Host keeps: the whole engine, not one Space's view. */
function engineWith(
	host: ReturnType<typeof hostKeeping>,
	internals: EngineInternals,
): Engine {
	const runLog = createRunLog(sandbox.db, {
		walkerId: sandbox.deviceId,
		dataDir: sandbox.dataDir,
	});
	runLogs.push(runLog);
	return createEngine(
		withDevice({
			db: sandbox.db,
			harnesses: { "claude-code": scriptedHarness().harness },
			deviceId: sandbox.deviceId,
			dataDir: sandbox.dataDir,
			peers: host.peers,
			directory: host.directory,
		}),
		{ runLog, minuteMs: MINUTE_MS, ...internals },
	);
}

describe("after a restart, in a Space a Host keeps", () => {
	test("given a run that sleeps holding a lease of 2 minutes, when the link to the Host comes up after the new daemon started, then it renews the lease at once, not a minute later", async () => {
		let at = now();
		// Real minutes: no renewal timer fires while the test runs.
		const clock = { now: () => at, minuteMs: 60_000 };
		const host = hostKeeping(clock.now);
		const dies = new AbortController();
		const first = engineWith(host, { ...clock, signal: dies.signal });
		const project = await projectId(first.space(sandbox.spaceId));
		host.keep();
		const run = await first
			.space(sandbox.spaceId)
			.startRun({ projectId: project, flow: holdingFlow({ ttlMinutes: 2 }) });
		await statusOf(first.space(sandbox.spaceId), run.id, "sleeping");
		expect(await holders(at)).toEqual({ "zac-docker-stack": run.id });
		const firstExpiry = await expiryOf();
		// The first daemon dies a minute and a half after its last renewal.
		dies.abort();
		at += 90_000;
		// The new daemon starts while its link to the Host is down.
		host.link.up = false;
		const before = host.link.renewals;
		const ends = new AbortController();
		const second = engineWith(host, { ...clock, signal: ends.signal });
		try {
			const space = second.space(sandbox.spaceId);
			expect((await space.getRun(run.id)).status).toBe("sleeping");
			// The renewal at the start does not reach the Host.
			await waitFor(() => host.link.renewals > before, {
				label: "the renewal at the start",
			});
			expect(await expiryOf()).toBe(firstExpiry);
			// The link comes up: the Device tells the engine.
			host.link.up = true;
			await second.hostBack();
			expect(await expiryOf()).toBeGreaterThan(firstExpiry);
			// Past the first ttl, before the new daemon's first minute is up.
			at += 60_000;
			expect(await holders(at)).toEqual({ "zac-docker-stack": run.id });
		} finally {
			ends.abort();
		}
	});
});

describe("people see and release leases", () => {
	test("given a run that holds a lease and one that waits for it, then each run page shows it", async () => {
		const engine = makeEngine();
		const first = await holdingRun(engine);
		const second = await engine.startRun({
			projectId: await projectId(engine),
			flow: politeFlow({ waitMinutes: 1_000 }),
		});
		await statusOf(engine, second.id, "sleeping");
		expect((await engine.getRun(first.id)).leases).toEqual([
			{
				name: "zac-docker-stack",
				state: "held",
				nodeId: "own",
				section: null,
				since: expect.any(Number),
				holder: null,
			},
		]);
		expect((await engine.getRun(second.id)).leases).toEqual([
			{
				name: "zac-docker-stack",
				state: "waiting",
				nodeId: "own",
				section: null,
				since: expect.any(Number),
				holder: { runId: first.id, title: first.title },
			},
		]);
	});

	test("given a run that holds a lease, when a person releases it, then the waiting run takes it and the first run goes on without it", async () => {
		const engine = makeEngine();
		const first = await holdingRun(engine);
		const second = await engine.startRun({
			projectId: await projectId(engine),
			flow: politeFlow({ waitMinutes: 1_000 }),
		});
		await statusOf(engine, second.id, "sleeping");
		await engine.act(first.id, {
			kind: "release-lease",
			name: "zac-docker-stack",
		});
		expect((await endOf(engine, second.id)).result).toBe("done");
		const detail = await engine.getRun(first.id);
		expect(detail.status).toBe("sleeping");
		expect(detail.leases).toEqual([]);
		const events = await (runLogs[0] as RunLog).events(first.id);
		expect(
			events.flatMap((e) => (e.type === "LeaseReleased" ? [e.payload] : [])),
		).toEqual([{ name: "zac-docker-stack", why: "person" }]);
		await expect(
			engine.act(first.id, { kind: "release-lease", name: "zac-docker-stack" }),
		).rejects.toThrow(
			'This run does not hold the lease "zac-docker-stack" now.',
		);
	});
});
