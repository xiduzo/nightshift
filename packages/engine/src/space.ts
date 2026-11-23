import type { ArtifactStore } from "./artifacts";
import type { AnswerCost } from "./assistant";
import type { Cleanup } from "./cleanup";
import type { Actor } from "./contract";
import type { FlowEditing, SpaceFlows } from "./flows";
import type { Gates } from "./gates";
import { type RunLog, scopeKey } from "./log";
import type { WithPaths } from "./peers";
import type { Catalog } from "./projects";
import type { RunStreamItem } from "./read";
import type { Access, Actions, Move, Start, Views } from "./runs";
import type { Schedules } from "./schedules";
import { readServiceLog } from "./services";
import type { SpaceEngine } from "./space-engine";
import type { SpaceMove } from "./space-move";
import type { Spaces } from "./spaces";

/**
 * What a person does in one Space (`SpaceEngine`). Every method reads and
 * touches that Space's rows only: a project or run of another Space is
 * "not found", the same answer as one that does not exist. Each method
 * waits for the engine to be ready, then hands over to the module that
 * owns the action: the run actions to `runs/actions`, which open the run
 * themselves. The flows are the module itself (`flows`): it waits and
 * checks the Space on its own.
 */
export type SpacesDeps = {
	ready: Promise<unknown>;
	/** The engine's lifetime: a watch ends with it. */
	signal: AbortSignal;
	log: RunLog;

	// --- projects, flows, kept values, node memory, answer costs (phase 3) ---
	/** A person's requests about the Projects (`projects/catalog`). */
	catalog: Catalog;
	/** The policy of the Space (`spaces/`). */
	spaces: Pick<Spaces, "setSpaceUsage">;
	/** The flows of the Space's projects, for the actor (`flows/wire.ts`). */
	flows(spaceId: string, actor: Actor): SpaceFlows;
	/** The kept values and the node memory of a project's flows on this computer (`flows/editing/`): each use case checks the Space itself. */
	editing: Pick<
		FlowEditing,
		"listKeptValues" | "resetKeptValue" | "listNodeMemory" | "forgetNodeMemory"
	>;
	/** What the answers of Night Shift's own agents cost in a Space, as this Replica has them. */
	answerCosts(
		actor: Actor,
		request: { spaceId: string; since?: number },
	): Promise<AnswerCost[]>;
	/** A person's move of a Project to another Space (`space-move/`). */
	moveProject: SpaceMove["moveProject"];

	// --- access, and the files of a run that other slices keep (R1) ---
	/** Opens a run for an actor: the one check of who may see or act on it (`runs/access`). */
	openRun: Access["openRun"];
	/** The files of run folders on this computer (`cleanup/`): each use case opens the run for the actor first. */
	runFiles: Pick<Cleanup, "listRunFiles" | "readRunFile">;
	/** The artifacts kept on this computer. */
	artifacts: Pick<ArtifactStore, "list" | "file">;
	/** Hides the worktree paths of runs on Devices the actor does not own. */
	pathsFor(
		spaceId: string,
		actor: Actor,
	): Promise<<T extends WithPaths>(summary: T) => Promise<T>>;

	// --- views (R2) ---
	/** The reads of the runs (`runs/views`): each opens the run, or the Space, for the actor. */
	views: Views;

	// --- start (R3) ---
	/** A run's start, and the Devices a person chooses from (`runs/start`): each use case checks the Space itself. */
	start: Pick<Start, "startRun" | "listPlacements" | "listDevices">;

	// --- actions (R4), move (R5), gates (R6) ---
	/** Stop, answer, signal, move, resume, restart and run again (`runs/actions`). */
	actions: { act: Actions["actOnRun"] };
	/** The Devices a run can move to (`runs/move`). */
	moveTargets: Move["listMoveTargets"];
	/** The open and the answered Gates of a Space (`gates/`). */
	gates: Pick<Gates, "listOpenGates" | "listAnsweredGates">;

	// --- schedules ---
	/** The schedules of the projects: each use case checks the Space itself (`schedules/`). */
	schedules: Pick<
		Schedules,
		| "list"
		| "save"
		| "pauseTonight"
		| "resumeTonight"
		| "runNow"
		| "previewCron"
	>;
};

export function createSpaces(deps: SpacesDeps) {
	const { ready, catalog, actions, views } = deps;

	/**
	 * The watch of a run for the actor: it waits for the engine, then opens
	 * the run, at the first read of the stream.
	 */
	async function* watch(
		actor: Parameters<Views["watchRun"]>[0],
		request: Parameters<Views["watchRun"]>[1],
	): AsyncGenerator<RunStreamItem> {
		await ready;
		yield* await views.watchRun(actor, request);
	}

	/** What a person does in one Space. */
	return function space(spaceId: string, actor: Actor): SpaceEngine {
		/** The run in this Space, opened for the actor. */
		const open = (runId: string) => deps.openRun(actor, { runId, spaceId });

		return {
			// --- projects and the Space's usage (phase 3): one use case each ---
			async listProjects() {
				await ready;
				return catalog.listProjects(actor, { spaceId });
			},

			async addProject(input) {
				await ready;
				return catalog.addProject(actor, { ...input, spaceId });
			},

			async addProjectWithoutFolder(input) {
				await ready;
				return catalog.addProjectWithoutFolder(actor, { ...input, spaceId });
			},

			async useProjectFolder(projectId, repoPath) {
				await ready;
				return catalog.useProjectFolder(actor, {
					spaceId,
					projectId,
					repoPath,
				});
			},

			async setUsage(enabled) {
				await ready;
				await deps.spaces.setSpaceUsage(actor, { spaceId, enabled });
			},

			async renameProject(projectId, name) {
				await ready;
				return catalog.renameProject(actor, { spaceId, projectId, name });
			},

			async moveProject(projectId, toSpaceId) {
				await ready;
				await deps.moveProject(actor, { spaceId, projectId, toSpaceId });
			},

			async removeProject(projectId) {
				await ready;
				await catalog.removeProject(actor, { spaceId, projectId });
			},

			async listBranches(projectId) {
				await ready;
				return catalog.listBranches(actor, { spaceId, projectId });
			},

			// --- kept values, node memory, flows, answer costs (phase 3) ---
			listKeptValues: (projectId, flowName) =>
				deps.editing.listKeptValues(actor, { spaceId, projectId, flowName }),

			resetKeptValue: (projectId, flowName, name) =>
				deps.editing.resetKeptValue(actor, {
					spaceId,
					projectId,
					flowName,
					name,
				}),

			listNodeMemory: (projectId, flowName) =>
				deps.editing.listNodeMemory(actor, { spaceId, projectId, flowName }),

			forgetNodeMemory: (projectId, flowName, node, scope) =>
				deps.editing.forgetNodeMemory(actor, {
					spaceId,
					projectId,
					flowName,
					node,
					...(scope !== undefined ? { scope } : {}),
				}),

			flows: deps.flows(spaceId, actor),

			async listAnswerCosts(since) {
				await ready;
				return deps.answerCosts(actor, { spaceId, since });
			},

			// --- views (R2): each read opens the run, or the Space, for the actor ---
			async projectRuns(read) {
				await ready;
				return views.listProjectRuns(actor, {
					spaceId,
					...(read !== undefined ? { read } : {}),
				});
			},

			async listRuns(input) {
				await ready;
				return views.listRuns(actor, { ...input, spaceId });
			},

			async getRun(runId) {
				await ready;
				return views.readRun(actor, { runId, spaceId });
			},

			async getStep(runId, stepId) {
				await ready;
				return views.readStep(actor, { runId, spaceId, stepId });
			},

			async stepTranscript(runId, stepId, signal) {
				await ready;
				return views.readStepTranscript(actor, {
					runId,
					spaceId,
					stepId,
					signal: AbortSignal.any([signal, deps.signal]),
				});
			},

			watchRun(runId, { signal: watching, afterSeq }) {
				// A disposed engine publishes nothing more on its bus: the watch
				// ends with it, so the watcher reconnects to the next engine.
				return watch(actor, {
					runId,
					spaceId,
					afterSeq: afterSeq ?? 0,
					signal: AbortSignal.any([watching, deps.signal]),
				});
			},

			// --- the files of a run that other slices keep (R1 opens the run, phase 3 moves them) ---
			async serviceLog(runId, service) {
				await ready;
				if (!(await open(runId)).walkedHere) return null;
				const state = await deps.log.state(runId);
				const hold = [...state.holds, ...state.endedHolding].find(
					(held) =>
						held.kind === "service" &&
						held.nodeId === service.nodeId &&
						scopeKey(held.scope) === service.scopeKey,
				);
				return hold?.kind === "service" ? readServiceLog(hold.logPath) : null;
			},

			async listArtifacts(runId) {
				await ready;
				await open(runId);
				return deps.artifacts.list(runId);
			},

			async artifactFile(runId, artifactId) {
				await ready;
				await open(runId);
				return deps.artifacts.file(runId, artifactId);
			},

			async listRunFiles(runId) {
				await ready;
				return deps.runFiles.listRunFiles(actor, { runId, spaceId });
			},

			async runFile(runId, path) {
				await ready;
				return deps.runFiles.readRunFile(actor, { runId, spaceId, path });
			},

			// --- start (R3) ---
			async listDevices(projectId, forNode) {
				await ready;
				return deps.start.listDevices(actor, {
					spaceId,
					projectId,
					...(forNode !== undefined ? { forNode } : {}),
				});
			},

			async listPlacements(projectId) {
				await ready;
				return deps.start.listPlacements(actor, {
					spaceId,
					projectId,
				});
			},

			async startRun(input) {
				await ready;
				// Asked before the start: who may see the paths of the run.
				const shown = await deps.pathsFor(spaceId, actor);
				return shown(
					await deps.start.startRun(actor, {
						...input,
						spaceId,
					}),
				);
			},

			// --- actions (R4) ---
			async act(runId, request) {
				await ready;
				await actions.act(actor, {
					spaceId,
					runId,
					action: request,
				});
			},

			// --- move (R5) ---
			async listMoveTargets(runId) {
				await ready;
				return deps.moveTargets(actor, { spaceId, runId });
			},

			// --- gates (R6) ---
			async listGates() {
				await ready;
				return deps.gates.listOpenGates(actor, { spaceId });
			},

			async listAnsweredGates(since) {
				await ready;
				return deps.gates.listAnsweredGates(actor, {
					spaceId,
					since,
				});
			},

			// --- schedules ---
			async listSchedules(projectId) {
				await ready;
				return deps.schedules.list(actor, { spaceId, projectId });
			},

			async pauseScheduleTonight(projectId, scheduleId) {
				await ready;
				return deps.schedules.pauseTonight(actor, {
					spaceId,
					projectId,
					scheduleId,
				});
			},

			async resumeScheduleTonight(projectId, scheduleId) {
				await ready;
				return deps.schedules.resumeTonight(actor, {
					spaceId,
					projectId,
					scheduleId,
				});
			},

			async runScheduleNow(projectId, scheduleId) {
				await ready;
				return deps.schedules.runNow(actor, {
					spaceId,
					projectId,
					scheduleId,
				});
			},

			async saveSchedules(projectId, schedules, timeZone) {
				await ready;
				return deps.schedules.save(actor, {
					spaceId,
					projectId,
					schedules,
					...(timeZone !== undefined ? { timeZone } : {}),
				});
			},

			// It reads no row: it does not wait for the engine to be ready.
			previewCron: (input) => deps.schedules.previewCron(actor, input),
		};
	};
}
