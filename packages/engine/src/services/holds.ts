import type { Device } from "../device";
import type { RunHolds } from "../graph";
import { holdCovers, type RunLog, type ServiceHold } from "../log";
import { RunRefusal } from "../run-status";
import type { ServiceKeeper } from "./keeper";

/**
 * The services of a run as the engine stops them (`RunHolds`):
 *
 * - On every end of the run they stop. An interrupted run keeps them for
 *   startup recovery: it continues the run, or tells `notContinuing`,
 *   and then they stop.
 * - A run that resumes after the daemon died stops what still runs of its
 *   services. It does not assume that the old process still lives. Then it starts again each
 *   service whose scope holds the node it resumes at, with the commands
 *   the log has, and waits until the service is ready. It logs each again
 *   (`ServiceStarted` with `again`, on no step). A service that does not
 *   get ready refuses the resume: the ones it started stop again.
 */
export function serviceHolds(deps: {
	keeper: Pick<ServiceKeeper, "stop" | "bringUp">;
	log: Pick<RunLog, "state" | "append">;
	/** The Device a service runs on, as a step of its run reaches it. Null: it cannot be reached. */
	deviceOf(runId: string, deviceId: string): Promise<Device | null>;
}): RunHolds {
	/** The services the run held when it ended. */
	async function endedServices(runId: string): Promise<ServiceHold[]> {
		const state = await deps.log.state(runId);
		return state.endedHolding.filter(
			(hold): hold is ServiceHold => hold.kind === "service",
		);
	}
	async function stopAll(
		runId: string,
		services: readonly ServiceHold[],
	): Promise<void> {
		if (services.length === 0) return;
		const devices = await Promise.all(
			services.map((service) =>
				deps.deviceOf(runId, service.deviceId).catch(() => null),
			),
		);
		await deps.keeper.stop(
			runId,
			services.map((service, i) => ({
				service,
				device: devices[i] ?? null,
			})),
		);
	}
	return {
		async ended(runId, status) {
			if (status === "interrupted") return;
			await stopAll(runId, await endedServices(runId));
		},
		notContinuing: async (runId) => stopAll(runId, await endedServices(runId)),
		async resuming(row, run, at) {
			const services = run.endedHolding.filter(
				(hold): hold is ServiceHold => hold.kind === "service",
			);
			// Only an interrupted run did not stop them when it ended.
			if (run.latest?.ended?.status === "interrupted") {
				await stopAll(row.id, services);
			}
			const parentOf = (stepId: string) => {
				const step = run.steps.get(stepId);
				return step ? { nodeId: step.nodeId, scope: step.scope } : null;
			};
			const again = services.filter((hold) => holdCovers(hold, at, parentOf));
			const started: ServiceHold[] = [];
			for (const service of again) {
				const device = await deps
					.deviceOf(row.id, service.deviceId)
					.catch(() => null);
				const refuse = async (why: string): Promise<never> => {
					await stopAll(row.id, started);
					throw new RunRefusal(
						"not-now",
						`The service "${service.nodeId}" did not start again. ${why}`,
					);
				};
				if (!device) {
					await refuse("Its computer cannot be reached now. Try again later.");
					continue;
				}
				let now = service;
				const up = await deps.keeper.bringUp({
					runId: row.id,
					nodeId: service.nodeId,
					scope: service.scope,
					device,
					here: service.deviceId === row.walkerId,
					cwd: service.cwd,
					spec: service.spec,
					logPath: service.logPath,
					signal: new AbortController().signal,
					onStarted: async ({ pid, startedAt }) => {
						now = { ...service, pid, startedAt };
						started.push(now);
						await deps.log.append({
							type: "ServiceStarted",
							runId: row.id,
							payload: {
								nodeId: service.nodeId,
								scope: service.scope,
								...(service.section ? { section: service.section } : {}),
								deviceId: service.deviceId,
								cwd: service.cwd,
								logPath: service.logPath,
								pid,
								startedAt,
								spec: service.spec,
								again: true,
							},
						});
					},
				});
				if (up.kind !== "ready") {
					// The keeper stopped it already.
					const at = started.indexOf(now);
					if (at >= 0) started.splice(at, 1);
					await refuse(up.kind === "failed" ? up.reason : "");
				}
			}
		},
	};
}
