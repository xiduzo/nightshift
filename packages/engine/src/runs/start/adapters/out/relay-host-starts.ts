import type { Database } from "@nightshift/db";
import { Refusal } from "@nightshift/refusal";
import {
	HostUnreachableError,
	NotOnThisComputer,
	type Relay,
} from "../../../../contract";
import { hasRunRow, type RunLog } from "../../../../log";
import type { RunSummary } from "../../../../read";
import type { HostStarts } from "../../application/ports";

/** How long a Device waits for a run its Host started to arrive. */
const RUN_ARRIVES_MS = 30_000;

/** How often it looks whether the run arrived. */
const LOOK_EVERY_MS = 200;

/** What the starts on a Host stand on: the Hosts this computer reaches, and this Replica's runs. */
export type RelayHostStartsDeps = {
	db: Database;
	log: Pick<RunLog, "events">;
	/** The Hosts this computer reaches (`Peers.relay`). Absent: none. */
	relay?: Pick<Relay, "startRun">;
	now(): number;
	/** The runs of a project in the Space, as the run list shows them. */
	listRuns(spaceId: string, projectId?: string): Promise<RunSummary[]>;
	/** How long to wait for the run. Default 30 s. */
	arrivesWithinMs?: number;
};

/**
 * The starts this computer hands to the Host that keeps a Space, over its
 * Link (`Relay.startRun`). The run's rows follow by the exchange: it
 * arrived when this Replica has its row and its first event, and the run
 * list of its project shows it. A Host without a Clone of the project
 * refuses with `NotOnThisComputer`, as the port says it.
 */
export function relayHostStarts(deps: RelayHostStartsDeps): HostStarts {
	const { db, log, relay } = deps;
	return {
		async start(input) {
			if (!relay) throw new HostUnreachableError();
			try {
				return await relay.startRun(input);
			} catch (error) {
				throw ofTheHost(error);
			}
		},
		async arrived({ runId, spaceId, projectId }) {
			const deadline = deps.now() + (deps.arrivesWithinMs ?? RUN_ARRIVES_MS);
			while (deps.now() < deadline) {
				if (
					(await hasRunRow(db, runId)) &&
					(await log.events(runId)).length > 0
				) {
					const [summary] = (await deps.listRuns(spaceId, projectId)).filter(
						(r) => r.id === runId,
					);
					if (summary) return summary;
				}
				await Bun.sleep(LOOK_EVERY_MS);
			}
			return null;
		},
	};
}

/**
 * What the Host threw. The wire has a refusal's kind and words, and no
 * more: the Host's own `NotOnThisComputer` is known by them, here only.
 */
function ofTheHost(error: unknown): unknown {
	const missing = new NotOnThisComputer({ cause: error });
	return error instanceof Refusal &&
		error.kind === missing.kind &&
		error.message === missing.message
		? missing
		: error;
}
