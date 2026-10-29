import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harnessFacts } from "@nightshift/agents/harness-facts";
import type {
	AgentEvent,
	AgentHarness,
	AgentSessionInput,
} from "@nightshift/agents/types";
import { createDb, type Database } from "@nightshift/db";
import { migrateDb } from "@nightshift/db/migrate";
import { device, event, organization } from "@nightshift/db/schema";
import { asc, eq, sql } from "drizzle-orm";
import type { DeviceDirectory } from "../contract/directory";
import { type LocalDeviceDeps, localDevice } from "../device/local";
import type { Device } from "../device/types";
import {
	type DeviceDocument,
	openDeviceDocument,
} from "../device-config/device-document";
import { parseEventRow } from "../log/events";
import type { RunLog } from "../log/run-log";
import { systemGit } from "../projects/git";
import { clonePathOf } from "../projects/projects";
import type { RunDetail } from "../read/views";
import type { Engine } from "../run/engine";
import type { EngineOptions } from "../run/engine-options";
import type { PeersFactory } from "../run/peers";
import type { SpaceEngine } from "../run/space-engine";
import { aloneDirectory, ownDevice } from "./alone-directory";
import { alonePeers } from "./alone-peers";

/** Test helpers: a temp git repo, a migrated temp database, scripted harnesses. */

/** The id of the Device tests run on. */
export const TEST_DEVICE_ID = "test-device";

/** What a test's Device is made of: this computer's deps, over fakes. */
export type TestDeviceDeps = Omit<LocalDeviceDeps, "id" | "name">;

/** This computer as a Device, over the test's fakes. */
export function testDevice(
	deps: TestDeviceDeps,
	id: string = TEST_DEVICE_ID,
): Device {
	return localDevice({ id, name: "test", ...deps });
}

/** The engine's options with the Device's deps beside them, as a test writes them. */
export type TestEngineOptions = Omit<
	EngineOptions,
	"device" | "peers" | "directory"
> &
	TestDeviceDeps & {
		/** The test Device's id. Default `TEST_DEVICE_ID`. */
		deviceId?: string;
		/** The other Devices and Hosts. Default: none (`alonePeers`). */
		peers?: PeersFactory;
		/** The Device rows. Default: those of a computer alone (`aloneDirectory`). */
		directory?: DeviceDirectory;
	};

/** Engine options whose Device is `testDevice` over the Device deps among them. */
export function withDevice(options: TestEngineOptions): EngineOptions {
	const {
		harnesses,
		harnessNames,
		customHarness,
		customHarnessNames,
		decider,
		mcpServersFor,
		connectionNames,
		cliNames,
		findCli,
		cliToolsFor,
		clonePath,
		git,
		deviceId,
		peers,
		directory = aloneDirectory(options.db),
		...engine
	} = options;
	return {
		...engine,
		directory,
		peers: peers ?? alonePeers,
		...(git ? { git } : {}),
		device: testDevice(
			{
				harnesses,
				harnessNames,
				customHarness,
				customHarnessNames,
				decider,
				mcpServersFor,
				connectionNames,
				cliNames,
				findCli,
				cliToolsFor,
				// The Clones of the database's own Device, as the daemon wires it.
				clonePath: clonePath ?? clonePathOf(engine.db, directory.selfId),
				git,
			},
			deviceId,
		),
	};
}

export type Sandbox = {
	root: string;
	repoPath: string;
	dataDir: string;
	dbPath: string;
	db: Database;
	/** The database's own Device: the Walker of its runs. */
	deviceId: string;
	/** The personal Space of the Device's owner: where the migration puts everything. */
	spaceId: string;
	/** Opens the Device document from the database, as a daemon start does. */
	openDocument(): Promise<DeviceDocument>;
	cleanup(): Promise<void>;
};

const gitIdentity = [
	"-c",
	"user.name=Night Shift Test",
	"-c",
	"user.email=test@nightshift.invalid",
	"-c",
	"commit.gpgsign=false",
];

/** The personal Space of this computer's Person, as the migration made it. */
export async function localSpaceId(db: Database): Promise<string> {
	const [row] = await db
		.select({ id: organization.id })
		.from(organization)
		.innerJoin(
			device,
			eq(organization.slug, sql`'personal-' || ${device.ownerId}`),
		)
		.where(eq(device.self, true));
	if (!row) throw new Error("The database has no personal Space.");
	return row.id;
}

/** Another Space with a member, as the organization plugin stores it. */
export async function otherSpace(
	db: Database,
	name = "Other",
): Promise<string> {
	const id = `space-${name.toLowerCase()}`;
	await db
		.insert(organization)
		.values({ id, name, slug: id, createdAt: new Date() });
	return id;
}

export async function createSandbox(): Promise<Sandbox> {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "nightshift-engine-")),
	);
	const repoPath = join(root, "repo");
	await Bun.write(join(repoPath, "README.md"), "# test repo\n");
	await mustGit(repoPath, ["init", "-q", "-b", "main"]);
	await mustGit(repoPath, ["add", "README.md"]);
	await mustGit(repoPath, [...gitIdentity, "commit", "-q", "-m", "initial"]);

	const dbPath = join(root, "nightshift.db");
	const db = createDb({ DATABASE_URL: `file:${dbPath}` });
	await migrateDb(db);
	const deviceId = (await ownDevice(db)).id;
	return {
		root,
		repoPath,
		dataDir: join(root, "data"),
		dbPath,
		db,
		deviceId,
		spaceId: await localSpaceId(db),
		openDocument: () => openDeviceDocument({ db, deviceId }),
		cleanup: () => rm(root, { recursive: true, force: true }),
	};
}

export async function commitFile(repoPath: string, name: string) {
	await writeFile(join(repoPath, name), `${name}\n`);
	await mustGit(repoPath, ["add", name]);
	await mustGit(repoPath, [...gitIdentity, "commit", "-q", "-m", name]);
}

export async function mustGit(cwd: string, args: string[]): Promise<string> {
	const result = await systemGit().run(cwd, args);
	if (result.exitCode !== 0) {
		throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	}
	return result.stdout;
}

/** An async queue that a test feeds by hand. */
class Channel<T> {
	private items: T[] = [];
	private closed = false;
	private wake: (() => void) | null = null;

	push(item: T) {
		if (this.closed) return;
		this.items.push(item);
		this.notify();
	}

	close() {
		this.closed = true;
		this.notify();
	}

	private notify() {
		const wake = this.wake;
		this.wake = null;
		wake?.();
	}

	async *[Symbol.asyncIterator](): AsyncGenerator<T> {
		while (true) {
			const item = this.items.shift();
			if (item !== undefined) {
				yield item;
				continue;
			}
			if (this.closed) return;
			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
		}
	}
}

export type ScriptedSession = {
	input: AgentSessionInput;
	emit(event: AgentEvent): void;
	text(delta: string): void;
	finish(costUsd?: number): void;
	fail(message: string): void;
};

/**
 * A harness the test drives by hand. Each `run` call opens a session the
 * test reaches through `sessions`. Aborting ends the stream with an `error`
 * of kind `aborted`, as the real contract says.
 */
export function scriptedHarness(
	options: {
		/** Emitted at once when a session starts. */
		harnessSessionId?: (index: number) => string;
		/** Ignore the abort signal and never end (a daemon that died). */
		hang?: boolean;
		/** Emit nothing when a session starts: it hangs in its setup until the test speaks. */
		silent?: boolean;
	} = {},
) {
	const sessions: ScriptedSession[] = [];
	const harness: AgentHarness = {
		name: "claude-code",
		...harnessFacts("claude-code"),
		run(input) {
			const channel = new Channel<AgentEvent>();
			const index = sessions.length;
			const session: ScriptedSession = {
				input,
				emit: (event) => channel.push(event),
				text: (delta) => channel.push({ type: "text", messageId: "m1", delta }),
				finish: (costUsd) => {
					channel.push({
						type: "finished",
						usage: { inputTokens: 10, outputTokens: 5, costUsd },
					});
					channel.close();
				},
				fail: (message) => {
					channel.push({ type: "error", kind: "harness", message });
					channel.close();
				},
			};
			sessions.push(session);
			const id = options.harnessSessionId?.(index) ?? `harness-${index}`;
			if (!options.silent) {
				channel.push({ type: "session", sessionId: id, model: input.model });
			}
			if (!options.hang) {
				input.signal.addEventListener(
					"abort",
					() => {
						channel.push({
							type: "error",
							kind: "aborted",
							message: "Aborted by the user.",
						});
						channel.close();
					},
					{ once: true },
				);
			}
			return channel;
		},
	};
	return { harness, sessions };
}

export async function waitFor<T>(
	check: () =>
		| T
		| undefined
		| null
		| false
		| Promise<T | undefined | null | false>,
	{ timeoutMs = 5_000, label = "condition" } = {},
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await check();
		if (value) return value;
		await Bun.sleep(5);
	}
	throw new Error(`Timed out waiting for ${label}`);
}

/**
 * The clock of a run policy test (`EngineInternals.now`). It stands still
 * while a run works, and `follow` moves it to the run's wake time once the
 * run sleeps. A wait so lasts exactly its minutes on the engine's clock,
 * however late a busy machine fires the timer, and the work between two
 * waits takes no time on it.
 */
export function sleepClock(start = Date.now()) {
	let at = start;
	return {
		now: () => at,
		/** Moves the clock to each wake time of the run, until it no longer runs or sleeps. */
		follow(engine: Pick<SpaceEngine, "getRun">, runId: string) {
			return waitFor(
				async (): Promise<RunDetail | null> => {
					const detail = await engine.getRun(runId);
					if (detail.status === "sleeping" && (detail.wakeAt ?? at) > at) {
						at = detail.wakeAt ?? at;
					}
					const going =
						detail.status === "running" || detail.status === "sleeping";
					return going ? null : detail;
				},
				{ label: "the run to end", timeoutMs: 10_000 },
			);
		},
	};
}

/**
 * Every run log keeps in memory exactly what a fresh read of the database
 * gives. The run logs are the engines of one test, oldest first. A run that
 * a later engine read is left out of the earlier ones: that engine is a
 * daemon that a restart replaced, and the next one wrote behind its back
 * (the lease rules this out for real daemons). Waits a little for appends
 * still on their way.
 */
export async function expectRunLogsInSync(
	db: Database,
	runLogs: readonly RunLog[],
): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (true) {
		const drift: string[] = [];
		const takenOver = new Set<string>();
		for (const runLog of [...runLogs].reverse()) {
			const cached = runLog.cached();
			for (const [runId, events] of cached) {
				if (takenOver.has(runId)) continue;
				const rows = await db
					.select()
					.from(event)
					.where(eq(event.runId, runId))
					.orderBy(asc(event.seq));
				if (!Bun.deepEquals(events, rows.map(parseEventRow), true)) {
					drift.push(runId);
				}
			}
			for (const runId of cached.keys()) takenOver.add(runId);
		}
		if (drift.length === 0) return;
		if (Date.now() > deadline) {
			throw new Error(
				`The run log differs from the database for run ${drift.join(", ")}`,
			);
		}
		await Bun.sleep(10);
	}
}

/**
 * Holds the Space as a Space move does from its plan through its batch:
 * a move of no Projects whose plan waits. Resolves once the hold is in
 * place, with the release, which resolves once the move is done.
 */
export async function holdSpace(
	engine: Pick<Engine, "moveProjects">,
	spaceId: string,
): Promise<() => Promise<void>> {
	let inside = () => {};
	const held = new Promise<void>((resolve) => {
		inside = resolve;
	});
	let release = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	const moving = engine.moveProjects({
		from: spaceId,
		plan: async () => {
			inside();
			await released;
			return { projects: {} };
		},
	});
	await Promise.race([held, moving]);
	return async () => {
		release();
		await moving;
	};
}
