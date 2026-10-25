import { Refusal } from "@nightshift/refusal";

import type { ArtifactStore } from "../artifacts";
import type { RunCopiesService } from "../cleanup";
import type {
	Actor,
	PlacementPort,
	SpaceEngine,
	StartRunInput,
	WithPaths,
} from "../contract";
import { type FlowFiles, flowUse } from "../flows";
import type { Runner } from "../graph";
import {
	RUN_NOT_FOUND,
	type RunLog,
	type RunRow,
	type RunTrigger,
} from "../log";
import {
	type Branches,
	type ListedProject,
	PROJECT_NOT_FOUND,
	type Projects,
	type SpaceDocuments,
	toProject,
} from "../projects";
import {
	deriveRunState,
	type ReadModel,
	type RunStreamItem,
	type RunSummary,
} from "../read";
import type { ScheduleFiles } from "../schedules";
import type { RunActions } from "./actions";
import type { RunRelay } from "./relay";

/**
 * What a person does in one Space (`SpaceEngine`). Every method reads and
 * touches that Space's rows only: a project or run of another Space is
 * "not found", the same answer as one that does not exist. Each method
 * waits for the engine to be ready, then hands over to the module that
 * owns the action: the run actions to `actions.ts`, which reads the run's
 * row itself.
 */
export type SpacesDeps = {
	ready: Promise<unknown>;
	/** The engine's lifetime: a watch ends with it. */
	signal: AbortSignal;
	/** This computer's Device id. */
	deviceId: string;
	log: RunLog;
	runner: Pick<Runner, "isActive">;
	projects: Projects;
	documents: SpaceDocuments;
	/** The ids of the project's runs. */
	runIdsOfProject(projectId: string): Promise<string[]>;
	/** The run's row, or "not found". */
	runRow(runId: string): Promise<RunRow>;
	listBranches(repoPath: string): Promise<Branches>;
	/** What runs left on this computer, and their removal. */
	runCopies: Pick<
		RunCopiesService,
		"list" | "removeRunCopy" | "deleteRunBranches"
	>;
	placement: Pick<PlacementPort, "devicesFor" | "placements">;
	flowFiles: FlowFiles;
	scheduleFiles: ScheduleFiles;
	reads: ReadModel;
	/** The artifacts kept on this computer. */
	artifacts: Pick<ArtifactStore, "list" | "file">;
	/** Stop, answer, signal, move, resume, restart and run again (`actions.ts`). */
	actions: RunActions;
	relay: Pick<RunRelay, "startOnHost">;
	/** The Host that keeps the Space, or null for a Space of this Replica's own. */
	hostOf(spaceId: string): Promise<string | null>;
	startRun(input: StartRunInput, trigger: RunTrigger): Promise<RunSummary>;
	/** Hides the worktree paths of runs on Devices the actor does not own. */
	pathsFor(
		spaceId: string,
		actor: Actor | undefined,
	): Promise<<T extends WithPaths>(summary: T) => Promise<T>>;
};

export function createSpaces(deps: SpacesDeps) {
	const { ready, log, projects, documents, reads, actions } = deps;

	/** The run's row when it is in the Space, else "not found". */
	async function getRunRow(runId: string, spaceId: string): Promise<RunRow> {
		const row = await deps.runRow(runId);
		if (row.spaceId !== spaceId) throw new Refusal("not-found", RUN_NOT_FOUND);
		return row;
	}

	/** Rows as the engine's Projects, with their Clones from the Space document. */
	async function withClones(spaceId: string, rows: ListedProject[]) {
		const document = await documents.open(spaceId);
		const deviceId = await log.walkerId();
		return rows.map((row) => toProject(row, document, deviceId));
	}

	/** Refuses while a run of the project runs a step. */
	async function noActiveRun(projectId: string, what: string) {
		const runIds = await deps.runIdsOfProject(projectId);
		if (runIds.some((id) => deps.runner.isActive(id))) {
			throw new Refusal(
				"conflict",
				`A run of this project is still running. Stop it to ${what}.`,
			);
		}
		return runIds;
	}

	async function* watch(
		runId: string,
		spaceId: string,
		signal: AbortSignal,
		afterSeq: number,
	): AsyncGenerator<RunStreamItem> {
		await ready;
		await getRunRow(runId, spaceId);
		yield* reads.watch(runId, signal, afterSeq);
	}

	/** What a person does in one Space. */
	return function space(spaceId: string, actor?: Actor): SpaceEngine {
		return {
			async listProjects() {
				await ready;
				return withClones(spaceId, await projects.listInSpace(spaceId));
			},

			async addProject(input) {
				await ready;
				const [added] = await withClones(spaceId, [
					await projects.add(input, spaceId),
				]);
				if (!added) throw new Error("Could not add the project.");
				return added;
			},

			// A rename, a move and a removal are the Space's: they need no Clone here.
			async renameProject(projectId, name) {
				await ready;
				await projects.find(projectId, spaceId);
				await projects.rename(projectId, name);
				const [renamed] = await withClones(spaceId, [
					await projects.find(projectId, spaceId),
				]);
				if (!renamed) throw new Refusal("not-found", PROJECT_NOT_FOUND);
				return renamed;
			},

			async moveProject(projectId, toSpaceId) {
				await ready;
				await projects.find(projectId, spaceId);
				await noActiveRun(projectId, "move the project");
				await projects.move(projectId, spaceId, toSpaceId);
			},

			async removeProject(projectId) {
				await ready;
				await projects.find(projectId, spaceId);
				const runIds = await noActiveRun(projectId, "remove the project");
				for (const runId of runIds) {
					const status = deriveRunState(await log.events(runId)).status;
					if (status === "waiting") {
						throw new Refusal(
							"conflict",
							"A run of this project waits at a Gate. Answer or stop it first.",
						);
					}
					if (status === "sleeping") {
						throw new Refusal(
							"conflict",
							"A run of this project sleeps until a wait ends. Stop it first.",
						);
					}
				}
				// Runs, events and worktrees stay: a person may still need them.
				await projects.remove(projectId);
			},

			async listBranches(projectId) {
				await ready;
				const row = await projects.get(projectId, spaceId);
				return deps.listBranches(row.repoPath);
			},

			async listRunCopies(projectId) {
				await ready;
				return deps.runCopies.list(spaceId, projectId);
			},

			async removeRunCopy(runId, options) {
				await ready;
				await deps.runCopies.removeRunCopy(spaceId, runId, options);
			},

			async deleteRunBranches(runId, options) {
				await ready;
				await deps.runCopies.deleteRunBranches(spaceId, runId, options);
			},

			async listDevices(projectId, forNode) {
				await ready;
				if (!actor) {
					throw new Refusal("signed-out", "Sign in to see your devices.");
				}
				return deps.placement.devicesFor(
					spaceId,
					actor.personId,
					projectId,
					forNode,
				);
			},

			async listPlacements(projectId) {
				await ready;
				if (!actor) throw new Refusal("signed-out", "Sign in to start a run.");
				return deps.placement.placements(spaceId, actor.personId, projectId);
			},

			async listFlows(projectId) {
				await ready;
				return deps.flowFiles.list(spaceId, projectId, actor?.personId);
			},

			async getFlow(projectId, name) {
				await ready;
				return deps.flowFiles.get(spaceId, projectId, name, actor?.personId);
			},

			async saveFlow(projectId, name, flow) {
				await ready;
				return deps.flowFiles.save(spaceId, projectId, name, flow);
			},

			async deleteFlow(projectId, name) {
				await ready;
				await deps.flowFiles.remove(spaceId, projectId, name);
			},

			flowUse() {
				return flowUse(this);
			},

			async listRuns(input) {
				await ready;
				const runs = await reads.listRuns(spaceId, input?.projectId);
				const shown = await deps.pathsFor(spaceId, actor);
				return Promise.all(runs.map(shown));
			},

			async getRun(runId) {
				await ready;
				await getRunRow(runId, spaceId);
				return (await deps.pathsFor(spaceId, actor))(await reads.getRun(runId));
			},

			async listArtifacts(runId) {
				await ready;
				await getRunRow(runId, spaceId);
				return deps.artifacts.list(runId);
			},

			async artifactFile(runId, artifactId) {
				await ready;
				await getRunRow(runId, spaceId);
				return deps.artifacts.file(runId, artifactId);
			},

			async startRun(input: StartRunInput) {
				await ready;
				await projects.find(input.projectId, spaceId);
				const { deviceId } = input;
				if (
					deviceId !== undefined &&
					deviceId !== deps.deviceId &&
					deviceId !== (await log.walkerId()) &&
					(await deps.hostOf(spaceId)) !== null
				) {
					// A run for another Device: the Space's Host walks it.
					return deps.relay.startOnHost({ ...input, deviceId }, spaceId);
				}
				return (await deps.pathsFor(spaceId, actor))(
					await deps.startRun(input, { kind: "manual" }),
				);
			},

			async stopRun(runId, stopOptions) {
				await ready;
				await actions.act(spaceId, actor, runId, {
					kind: "stop",
					...(stopOptions?.when ? { when: stopOptions.when } : {}),
				});
			},

			async moveRun(runId, to) {
				await ready;
				await actions.act(spaceId, actor, runId, { kind: "move", to });
			},

			async listMoveTargets(runId) {
				await ready;
				return actions.moveTargets(spaceId, actor, runId);
			},

			async resumeRun(runId, prompt) {
				await ready;
				await actions.act(spaceId, actor, runId, {
					kind: "resume",
					...(prompt !== undefined ? { prompt } : {}),
				});
			},

			async restartStep(runId, options) {
				await ready;
				await actions.act(spaceId, actor, runId, {
					kind: "restart",
					...(options?.prompt !== undefined ? { prompt: options.prompt } : {}),
					...(options?.stepId !== undefined ? { stepId: options.stepId } : {}),
				});
			},

			async rerunFrom(runId, options) {
				await ready;
				await actions.act(spaceId, actor, runId, {
					kind: "rerun",
					nodeId: options.nodeId,
					...(options.stepId !== undefined ? { stepId: options.stepId } : {}),
					...(options.prompt !== undefined ? { prompt: options.prompt } : {}),
					...(options.fresh ? { fresh: true } : {}),
				});
			},

			async listGates() {
				await ready;
				return reads.listGates(spaceId);
			},

			async listSchedules(projectId) {
				await ready;
				const row = await projects.get(projectId, spaceId);
				return deps.scheduleFiles.list(row);
			},

			async saveSchedules(projectId, schedules) {
				await ready;
				const row = await projects.get(projectId, spaceId);
				return deps.scheduleFiles.save(row, spaceId, actor, schedules);
			},

			async resolveGate({ runId, stepId, choice, note }) {
				await ready;
				await actions.act(spaceId, actor, runId, {
					kind: "answer",
					stepId,
					choice,
					...(note !== undefined ? { note } : {}),
				});
			},

			async signalRun(runId, name) {
				await ready;
				await actions.act(spaceId, actor, runId, { kind: "signal", name });
			},

			watchRun(runId, { signal: watching, afterSeq }) {
				// A disposed engine publishes nothing more on its bus: the watch
				// ends with it, so the watcher reconnects to the next engine.
				return watch(
					runId,
					spaceId,
					AbortSignal.any([watching, deps.signal]),
					afterSeq ?? 0,
				);
			},
		};
	};
}
