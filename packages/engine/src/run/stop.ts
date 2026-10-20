import type { Actor, SpaceEngine } from "../contract";
import type { Runner } from "../graph";
import type { RunBus, RunLog, RunRow } from "../log";
import { deriveRunState, deriveStopAfterStep } from "../read";
import type { RunRelay } from "./relay";

type StopOptions = Parameters<SpaceEngine["stopRun"]>[1];

/**
 * Stops a run: now, or after its running step (`after-step`, which
 * `cancel-after-step` takes back). Each writes one run-level fact. On a
 * run another Device walks the stop travels to its Walker as a command,
 * and a run that has ended takes none.
 */
export async function stopRun(
	deps: {
		log: RunLog;
		bus: RunBus;
		runner: Pick<Runner, "exclusive" | "stop">;
		relay: RunRelay;
	},
	row: RunRow,
	actor: Actor | undefined,
	options: StopOptions,
): Promise<void> {
	const { log, bus, runner, relay } = deps;
	const runId = row.id;
	if (await relay.walkedElsewhere(row)) {
		const status = deriveRunState(await log.events(runId)).status;
		if (status !== "running" && status !== "waiting" && status !== "sleeping") {
			return;
		}
		await relay.send(row, actor, {
			kind: "run.stop",
			payload: options?.when ? { when: options.when } : {},
		});
		return;
	}
	if (options?.when === "after-step" || options?.when === "cancel-after-step") {
		const request = options.when === "after-step";
		await runner.exclusive(runId, async () => {
			const events = await log.events(runId);
			const status = deriveRunState(events).status;
			if (
				status !== "running" &&
				status !== "waiting" &&
				status !== "sleeping"
			) {
				return;
			}
			if (deriveStopAfterStep(events) === request) return;
			await log.append({
				type: request ? "StopAfterStepRequested" : "StopAfterStepCancelled",
				runId,
				payload: {},
			});
			bus.publish(runId, { kind: "status-changed" });
		});
		return;
	}
	await runner.stop(runId);
}
