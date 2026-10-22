import { roleAllows } from "@nightshift/auth";
import type { Engine } from "@nightshift/engine";
import type { HostClient, RunCommand, RunRows } from "../contract";
import { hostErrorOf } from "../links";
import { applyRunCommand, COMMAND_PERMISSION } from "./commands";
import type { EngineExchange } from "./engine-exchange";
import { isEmpty, MissingProjectError } from "./rows";

/**
 * This Device's half of the exchange of run history with one Host (the
 * Host's half is `HostExchange`). One per Host for the life of the
 * daemon; `run` is one online period of its Link. Two loops, both
 * outbound, both by cursor:
 *
 * - Push: the rows this computer walked in the Spaces the Host keeps,
 *   after the Host's cursor, whenever an event lands here. After a batch
 *   with a node that ended, that step's transcript and command log, and
 *   its run's walk state, go to the Host's archive (the Host takes files
 *   of runs it has). The cursor moves when both are done: a batch that
 *   fails halfway goes again, whole.
 * - Pull: `sync.stream` from this Replica's cursors: other Walkers' rows
 *   as they land on the Host, and the commands for the runs this computer
 *   walks. A batch whose project has not arrived yet (its Space document
 *   is on its way) waits for it, then the stream starts again from the
 *   same cursor. The stream also says which steps of this computer's runs
 *   someone follows: their live transcripts go to the Host
 *   (`archive.tail`) while they are wanted.
 *
 * A command is checked again here, from this Replica: the run is this
 * computer's, and the Person who asked is a Member of its Space with a
 * role that allows the action (the Space document's mirror of the
 * Members). Then it is applied like a local action, and the Host is told.
 * A command is applied once: its result is kept until the Host stops
 * sending it, so a link that drops before the Host heard the result sends
 * the same result again, and does not apply the command twice. The
 * results are kept in memory: a restart between the two can still apply
 * a command twice.
 *
 * The Host offline: this computer keeps walking its runs. When the link
 * is back, both loops start at the cursors and catch up.
 */
export type DeviceExchange = {
	/** Pushes, pulls and applies over `client` until `signal` aborts (the link dropped). Never throws. */
	run(client: HostClient, signal: AbortSignal): Promise<void>;
};

export function createDeviceExchange(deps: {
	/** This Device's engine (`PeerEngine`), with its half of the exchange. */
	engine: Engine & { exchange: EngineExchange };
	hostId: string;
	/** This computer's Device id: the Walker of its runs. */
	selfId: string;
	/** How long to wait after a failure before trying again. Default 2 s. */
	retryMs?: number;
	/** How long a batch waits for its project before the stream starts again. Default 30 s. */
	projectWaitMs?: number;
	/** How long the push loop waits for a new row before it looks again. Default 15 s. */
	idleMs?: number;
}): DeviceExchange {
	const { engine, hostId, selfId } = deps;
	const { rows } = engine.exchange;
	const retryMs = deps.retryMs ?? 2_000;

	/** The commands applied here, with what each reported, while the Host still sends them. */
	const applied = new Map<string, string | null>();

	async function push(client: HostClient, signal: AbortSignal) {
		/** The batch the Host refused last: said once, not at every retry. */
		let refused: string | null = null;
		while (!signal.aborted) {
			const cycle = new AbortController();
			const landed = rows.landed(
				AbortSignal.any([signal, cycle.signal]),
				deps.idleMs ?? 15_000,
			);
			let batchKey: string | null = null;
			try {
				const spaces = await engine.exchange.hostSpaces.ofHost(hostId);
				const { rows: batch, cursors } = await rows.rowsAfter({
					spaces,
					cursors: await rows.cursorsWith(hostId),
					only: selfId,
					limit: 200,
				});
				if (isEmpty(batch)) {
					await landed;
					continue;
				}
				batchKey = JSON.stringify(cursors);
				await client.sync.push(batch, { signal });
				// The Host has the runs now: their ended nodes' files follow.
				await archive(client, batch, signal);
				await rows.advance(hostId, cursors);
				refused = null;
			} catch (error) {
				if (signal.aborted) return;
				if (hostErrorOf(error) !== "denied" || refused !== batchKey) {
					console.error("Run history was not sent to the Host:", error);
				}
				if (hostErrorOf(error) === "denied") refused = batchKey;
				await pause(retryMs, signal);
			} finally {
				cycle.abort();
			}
		}
	}

	/** Puts the files of the batch's ended nodes, and their runs' walk state, in the Host's archive. */
	async function archive(
		client: HostClient,
		batch: RunRows,
		signal: AbortSignal,
	) {
		/** The ended steps of each run with an ended step or end. */
		const ended = new Map<string, string[]>();
		for (const e of batch.events) {
			const stepId = e.type === "StepEnded" ? e.stepId : null;
			if (!stepId && e.type !== "RunEnded") continue;
			const steps = ended.get(e.runId) ?? [];
			if (stepId) steps.push(stepId);
			ended.set(e.runId, steps);
		}
		for (const [runId, steps] of ended) {
			// Empty for a run that has moved since: its new Walker sends its files.
			for (const { ref, content } of await engine.exchange.exportWalk(runId, {
				steps,
			})) {
				await client.archive.put({ ref, content }, { signal });
			}
		}
	}

	async function pull(client: HostClient, signal: AbortSignal) {
		/** The commands whose result the Host has from this online period. */
		const reported = new Set<string>();
		while (!signal.aborted) {
			// The live transcripts the Host wants of this computer's runs. A
			// stream that ends stops them: the next one says again what it wants.
			const pumps = engine.exchange.feeds.pumps((step, entries, ended, stop) =>
				client.archive.tail(
					{ step, entries, ended },
					{ signal: AbortSignal.any([signal, stop]) },
				),
			);
			try {
				const stream = await client.sync.stream(
					{ cursors: await rows.cursorsWith(hostId) },
					{ signal },
				);
				for await (const batch of stream) {
					// A Host of an older version sends no follows.
					pumps.set(batch.follows ?? []);
					if (!isEmpty(batch.rows)) {
						await ingestWhenReady(batch.rows, signal);
						await rows.advance(hostId, batch.cursors);
					}
					for (const command of batch.commands) {
						if (reported.has(command.id)) continue;
						let error = applied.get(command.id);
						if (error === undefined) {
							error = await apply(command);
							applied.set(command.id, error);
						}
						await client.sync.commandDone(
							{ id: command.id, error },
							{ signal },
						);
						reported.add(command.id);
					}
					// The batch has every command that waits: one it lacks is done there.
					const pending = new Set(batch.commands.map((c) => c.id));
					for (const id of applied.keys()) {
						if (!pending.has(id)) applied.delete(id);
					}
					for (const id of reported) {
						if (!pending.has(id)) reported.delete(id);
					}
				}
			} catch (error) {
				if (signal.aborted) return;
				console.error("Run history was not received from the Host:", error);
			} finally {
				pumps.close();
			}
			await pause(retryMs, signal);
		}
	}

	/** Ingests a batch, waiting a while for a project its Space document still brings. */
	async function ingestWhenReady(batch: RunRows, signal: AbortSignal) {
		const deadline = Date.now() + (deps.projectWaitMs ?? 30_000);
		while (true) {
			try {
				await rows.ingest(batch);
				return;
			} catch (error) {
				if (!(error instanceof MissingProjectError) || Date.now() > deadline) {
					throw error;
				}
				await pause(250, signal);
				if (signal.aborted) throw error;
			}
		}
	}

	/** Applies a command for a run this computer walks. Returns why not, or null. */
	async function apply(command: RunCommand): Promise<string | null> {
		const owner = await engine.exchange.runOwner(command.runId);
		if (
			!owner ||
			owner.walkerId !== selfId ||
			owner.spaceId !== command.spaceId
		) {
			return "This device does not run this run.";
		}
		const role = await engine.exchange.memberRole(
			command.spaceId,
			command.personId,
		);
		if (!role || !roleAllows(role, COMMAND_PERMISSION[command.kind])) {
			return "The person who asked may not do this in this Space.";
		}
		try {
			await applyRunCommand(
				engine.space(command.spaceId, { personId: command.personId }),
				command,
			);
			return null;
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
	}

	return {
		async run(client, signal) {
			await Promise.all([push(client, signal), pull(client, signal)]);
		},
	};
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}
