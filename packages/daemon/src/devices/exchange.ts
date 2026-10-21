import type { AppRouterClient } from "@nightshift/api";
import { roleAllows } from "@nightshift/auth";
import type { Engine } from "@nightshift/engine";
import {
	type ArchiveRef,
	applyRunCommand,
	COMMAND_PERMISSION,
	isEmpty,
	MissingProjectError,
	type RunCommand,
	type RunRows,
} from "@nightshift/engine";

/**
 * The exchange of run history with one Host, while its Link is online
 * (`whileOnline`). Two loops, both outbound, both by cursor:
 *
 * - Push: the rows this computer walked in the Spaces the Host keeps,
 *   after the Host's cursor, whenever an event lands here. After a batch
 *   with a node that ended, that step's transcript and command log, and
 *   its run's checkpoints, go to the Host's archive (the Host takes files
 *   of runs it has). The cursor moves when both are done: a batch that
 *   fails halfway goes again, whole.
 * - Pull: `sync.stream` from this Replica's cursors: other Walkers' rows
 *   as they land on the Host, and the commands for the runs this computer
 *   walks. A batch whose project has not arrived yet (its Space document
 *   is on its way) waits for it and is tried again. The stream also says
 *   which steps of this computer's runs someone follows: their live
 *   transcripts go to the Host (`archive.tail`) while they are wanted.
 *
 * A command is checked again here, from this Replica: the run is this
 * computer's, and the Person who asked is a Member of its Space with a
 * role that allows the action (the Space document's mirror of the
 * Members). Then it is applied like a local action, and the Host is told.
 *
 * The Host offline: this computer keeps walking its runs. When the link
 * is back, both loops start at the cursors and catch up.
 */

export type ExchangeSession = {
	engine: Engine;
	hostId: string;
	client: AppRouterClient;
	/** This computer's Device id: the Walker of its runs. */
	selfId: string;
	signal: AbortSignal;
	/** How long to wait after a failure before trying again. */
	retryMs?: number;
	/** How long a batch waits for its project before the stream starts again. */
	projectWaitMs?: number;
};

export async function exchangeWithHost(
	session: ExchangeSession,
): Promise<void> {
	await Promise.all([pushLoop(session), pullLoop(session)]);
}

async function pushLoop(session: ExchangeSession): Promise<void> {
	const { engine, hostId, client, selfId, signal } = session;
	const { rows } = engine.exchange;
	while (!signal.aborted) {
		const cycle = new AbortController();
		const landed = rows.landed(AbortSignal.any([signal, cycle.signal]), 15_000);
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
			await client.sync.push(batch, { signal });
			// The Host has the runs now: their ended nodes' files follow.
			await archive(session, batch);
			await rows.advance(hostId, cursors);
		} catch (error) {
			if (signal.aborted) return;
			console.error("Run history was not sent to the Host:", error);
			await pause(session.retryMs ?? 2_000, signal);
		} finally {
			cycle.abort();
		}
	}
}

/** Puts the files of the batch's ended nodes, and their runs' checkpoints, in the Host's archive. */
async function archive(session: ExchangeSession, batch: RunRows) {
	const { engine, client, signal } = session;
	const ended = batch.events.filter(
		(e) => (e.type === "StepEnded" && e.stepId) || e.type === "RunEnded",
	);
	const runs = new Map<string, string>();
	for (const e of ended) {
		runs.set(e.runId, e.spaceId);
		if (e.type !== "StepEnded" || !e.stepId) continue;
		const files = await engine.exchange.stepFiles(e.stepId);
		if (!files) continue;
		const at = { spaceId: files.spaceId, runId: files.runId, stepId: e.stepId };
		const puts: [ArchiveRef, string | null][] = [
			[{ kind: "transcript", ...at }, files.transcript],
			[{ kind: "log", ...at }, files.log],
		];
		for (const [ref, content] of puts) {
			if (content !== null)
				await client.archive.put({ ref, content }, { signal });
		}
	}
	for (const [runId, spaceId] of runs) {
		await client.archive.put(
			{
				ref: { kind: "checkpoint", spaceId, runId },
				content: await engine.exchange.checkpoint(runId),
			},
			{ signal },
		);
	}
}

async function pullLoop(session: ExchangeSession): Promise<void> {
	const { engine, hostId, client, signal } = session;
	const { rows } = engine.exchange;
	/** Commands applied in this session, until the Host has heard so. */
	const applied = new Set<string>();
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
					await ingestWhenReady(session, batch.rows);
					await rows.advance(hostId, batch.cursors);
				}
				for (const command of batch.commands) {
					if (applied.has(command.id)) continue;
					applied.add(command.id);
					const error = await apply(session, command);
					await client.sync.commandDone({ id: command.id, error }, { signal });
				}
			}
		} catch (error) {
			if (signal.aborted) return;
			console.error("Run history was not received from the Host:", error);
		} finally {
			pumps.close();
		}
		await pause(session.retryMs ?? 2_000, signal);
	}
}

/** Ingests a batch, waiting a while for a project its Space document still brings. */
async function ingestWhenReady(session: ExchangeSession, batch: RunRows) {
	const deadline = Date.now() + (session.projectWaitMs ?? 30_000);
	while (true) {
		try {
			await session.engine.exchange.rows.ingest(batch);
			return;
		} catch (error) {
			if (!(error instanceof MissingProjectError) || Date.now() > deadline) {
				throw error;
			}
			await pause(250, session.signal);
			if (session.signal.aborted) throw error;
		}
	}
}

/** Applies a command for a run this computer walks. Returns why not, or null. */
async function apply(
	session: ExchangeSession,
	command: RunCommand,
): Promise<string | null> {
	const { engine, selfId } = session;
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
