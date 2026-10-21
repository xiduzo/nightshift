import type { ArtifactStore } from "../artifacts";
import type {
	Actor,
	PlacementPort,
	SpaceEngine,
	StartRunInput,
	WithPaths,
} from "../contract";
import { type FlowFiles, flowUse } from "../flows";
import type { Runner } from "../graph";
import type { RunLog, RunRow, RunTrigger } from "../log";
import {
	type Branches,
	type ListedProject,
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
import type { Recovery } from "./recovery";
import type { RunRelay } from "./relay";

/**
 * What a person does in one Space (`SpaceEngine`). Every method reads and
 * touches that Space's rows only: a project or run of another Space is
 * "not found", the same answer as one that does not exist. Each method
 * waits for the engine to be ready, then hands over to the module that
 * owns the action.
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
	placement: Pick<PlacementPort, "devicesFor" | "placements">;
	flowFiles: FlowFiles;
	scheduleFiles: ScheduleFiles;
	reads: ReadModel;
	/** The artifacts kept on this computer. */
	artifacts: Pick<ArtifactStore, "list" | "file">;
	recovery: Pick<Recovery, "resume" | "restartStep" | "rerunFrom">;
	relay: RunRelay;
	/** The Host that keeps the Space, or null for a Space of this Replica's own. */
	hostOf(spaceId: string): Promise<string | null>;
	startRun(input: StartRunInput, trigger: RunTrigger): Promise<RunSummary>;
	/** Hides the worktree paths of runs on Devices the actor does not own. */
	pathsFor(
		spaceId: string,
		actor: Actor | undefined,
	): Promise<<T extends WithPaths>(summary: T) => Promise<T>>;
	/** The run actions that write a run-level fact, or travel to the Walker (`stop.ts`, `move.ts`, `gate.ts`, `wake.ts`). */
	control: {
		stop(
			row: RunRow,
			actor: Actor | undefined,
			options: Parameters<SpaceEngine["stopRun"]>[1],
		): Promise<void>;
		move(row: RunRow, actor: Actor | undefined, to: string): Promise<void>;
		resolveGate(
			row: RunRow,
			actor: Actor | undefined,
			input: Parameters<SpaceEngine["resolveGate"]>[0],
		): Promise<void>;
		signal(row: RunRow, actor: Actor | undefined, name: string): Promise<void>;
	};
};

export function createSpaces(deps: SpacesDeps) {
	const { ready, log, projects, documents, reads, recovery, control } = deps;

	/** The run's row when it is in the Space, else "not found". */
	async function getRunRow(runId: string, spaceId: string): Promise<RunRow> {
		const row = await deps.runRow(runId);
		if (row.spaceId !== spaceId) throw new Error(`Run not found: ${runId}`);
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
			throw new Error(
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
				if (!renamed) throw new Error(`Project not found: ${projectId}`);
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
						throw new Error(
							"A run of this project waits at a Gate. Answer or stop it first.",
						);
					}
					if (status === "sleeping") {
						throw new Error(
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

			async listDevices(projectId) {
				await ready;
				if (!actor) throw new Error("Sign in to see your devices.");
				return deps.placement.devicesFor(spaceId, actor.personId, projectId);
			},

			async listPlacements(projectId) {
				await ready;
				if (!actor) throw new Error("Sign in to start a run.");
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
				const row = await getRunRow(runId, spaceId);
				await control.stop(row, actor, stopOptions);
			},

			async moveRun(runId, to) {
				await ready;
				const row = await getRunRow(runId, spaceId);
				await control.move(row, actor, to);
			},

			async resumeRun(runId, prompt) {
				await ready;
				await getRunRow(runId, spaceId);
				await recovery.resume(runId, {
					by: "person",
					...(prompt !== undefined ? { prompt } : {}),
				});
			},

			async restartStep(runId, options) {
				await ready;
				await getRunRow(runId, spaceId);
				await recovery.restartStep(runId, {
					by: "person",
					...(options?.prompt !== undefined ? { prompt: options.prompt } : {}),
					...(options?.stepId !== undefined ? { stepId: options.stepId } : {}),
				});
			},

			async rerunFrom(runId, options) {
				await ready;
				await getRunRow(runId, spaceId);
				await recovery.rerunFrom(runId, {
					by: "person",
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

			async resolveGate(input) {
				await ready;
				const row = await getRunRow(input.runId, spaceId);
				await control.resolveGate(row, actor, input);
			},

			async signalRun(runId, name) {
				await ready;
				const row = await getRunRow(runId, spaceId);
				await control.signal(row, actor, name);
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
