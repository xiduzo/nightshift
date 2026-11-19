import type { RunBus, RunLog } from "../../../../log";
import type { RunFacts } from "../../application/ports";

export type LogRunFactsDeps = {
	log: Pick<RunLog, "state" | "events" | "append" | "walkerId">;
	bus: Pick<RunBus, "publish">;
};

/** A run's facts over the run log, and its watchers over the run bus. */
export function logRunFacts(deps: LogRunFactsDeps): RunFacts {
	const { log, bus } = deps;
	return {
		state: (runId) => log.state(runId),
		events: (runId) => log.events(runId),
		append: (event) => log.append(event),
		changed: (runId) => bus.publish(runId, { kind: "status-changed" }),
		walkerId: () => log.walkerId(),
	};
}
