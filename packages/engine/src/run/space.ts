import { Refusal } from "@nightshift/refusal";

import type { ArtifactStore } from "../artifacts";
import type { RunCopiesService } from "../cleanup";
import type { Actor, StartRunInput } from "../contract";
import { flowUse, type SpaceFlows } from "../flows";
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
import type { KeptFlow, KeptValue } from "../variables";
import type { RunActions } from "./actions";
import type { PlacementPort, WithPaths } from "./peers";
import type { MovedProjects, ProjectsMove } from "./projects-move";
import type { SpaceEngine } from "./space-engine";
import type { StartPlaces } from "./start-place";

/**
 * What a person does in one Space (`SpaceEngine`). Every method reads and
 * touches that Space's rows only: a project or run of another Space is
 * "not found", the same answer as one that does not exist. Each method
 * waits for the engine to be ready, then hands over to the module that
 * owns the action: the run actions to `actions.ts`, which reads the run's
 * row itself. The flows are the module itself (`flows`): it waits and
 * checks the Space on its own.
 */
export type SpacesDeps = {
	ready: Promise<unknown>;
	/** The engine's lifetime: a watch ends with it. */
	signal: AbortSignal;
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
	placement: Pick<PlacementPort, "devicesFor">;
	/** The Devices a run of the project can run on, the default marked (`start-place.ts`). */
	placements: StartPlaces["placements"];
	/** The flows of the Space's projects, for the Person who acts (`flows/space-flows.ts`). */
	flows(spaceId: string, personId?: string): SpaceFlows;
	/** The import on upgrade of this Device's Clone of the project, once. Never throws. */
	importClone(projectId: string): Promise<void>;
	/** The kept variables of a project's flows on this computer. */
	kept: {
		list(flow: KeptFlow): Promise<KeptValue[]>;
		reset(flow: KeptFlow, name: string): Promise<void>;
	};
	scheduleFiles: ScheduleFiles;
	reads: ReadModel;
	/** The artifacts kept on this computer. */
	artifacts: Pick<ArtifactStore, "list" | "file">;
	/** Stop, answer, signal, move, resume, restart and run again (`actions.ts`). */
	actions: RunActions;
	/**
	 * Starts a run where its start place says (`start-place.ts`), for the
	 * Person it runs for: here, or on the Host that keeps the Space.
	 */
	startRun(
		input: StartRunInput,
		trigger: RunTrigger,
		personId: string | null,
	): Promise<RunSummary>;
	/** A Space move (`projects-move.ts`). */
	moveProjects(move: ProjectsMove): Promise<MovedProjects>;
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
		yield* reads.watch(await getRunRow(runId, spaceId), signal, afterSeq);
	}

	/** What a person does in one Space. */
	return function space(spaceId: string, actor?: Actor): SpaceEngine {
		return {
			async listProjects() {
				await ready;
				return withClones(spaceId, await projects.listInSpace(spaceId));
			},

			async projectRuns() {
				await ready;
				return reads.projectRuns(spaceId);
			},

			async addProject(input) {
				await ready;
				const row = await projects.add(input, spaceId);
				// A folder from before ADR 2 brings its flows in.
				await deps.importClone(row.id);
				const [added] = await withClones(spaceId, [row]);
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
				if (toSpaceId === spaceId) return;
				await projects.refuseMove(projectId, spaceId, toSpaceId);
				await deps.moveProjects({
					from: spaceId,
					plan: async () => {
						await noActiveRun(projectId, "move the project");
						return {
							projects: { [projectId]: { spaceId: toSpaceId, projectId } },
						};
					},
				});
				await log.append({
					type: "ProjectMoved",
					payload: { projectId, from: spaceId, to: toSpaceId },
				});
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
				return deps.placements(spaceId, actor.personId, projectId);
			},

			async listKeptValues(projectId, flowName) {
				await ready;
				await projects.find(projectId, spaceId);
				return deps.kept.list({ spaceId, projectId, flowName });
			},

			async resetKeptValue(projectId, flowName, name) {
				await ready;
				await projects.find(projectId, spaceId);
				await deps.kept.reset({ spaceId, projectId, flowName }, name);
			},

			flows: deps.flows(spaceId, actor?.personId),

			flowUse() {
				return flowUse(this);
			},

			async listRuns(input) {
				await ready;
				const runs = await reads.listRuns(spaceId, input?.projectId, {
					...(input?.limit !== undefined ? { limit: input.limit } : {}),
					...(input?.cursor !== undefined ? { cursor: input.cursor } : {}),
					...(input?.statuses !== undefined
						? { statuses: input.statuses }
						: {}),
				});
				const shown = await deps.pathsFor(spaceId, actor);
				return Promise.all(runs.map(shown));
			},

			async getRun(runId) {
				await ready;
				const row = await getRunRow(runId, spaceId);
				return (await deps.pathsFor(spaceId, actor))(await reads.getRun(row));
			},

			async getStep(runId, stepId) {
				await ready;
				return reads.getStep(await getRunRow(runId, spaceId), stepId);
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
				return (await deps.pathsFor(spaceId, actor))(
					await deps.startRun(
						input,
						{ kind: "manual" },
						actor?.personId ?? null,
					),
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
				await projects.find(projectId, spaceId);
				return deps.scheduleFiles.list(projectId);
			},

			async saveSchedules(projectId, schedules) {
				await ready;
				// A project without a Clone here is refused before the Offers check.
				await projects.get(projectId, spaceId);
				return deps.scheduleFiles.save(spaceId, projectId, actor, schedules);
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
