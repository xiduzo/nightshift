import { Refusal } from "@nightshift/refusal";

import type { ArtifactStore } from "./artifacts";
import type { AnswerCost } from "./assistant";
import type { RunFilesService } from "./cleanup";
import { NIGHT_SHIFT, type PersonActor } from "./contract";
import type { SpaceFlows } from "./flows";
import type { Runner } from "./graph";
import { type RunLog, scopeKey } from "./log";
import type { MemoryFlow, NodeMemory } from "./memory";
import type { WithPaths } from "./peers";
import {
	type Branches,
	type ListedProject,
	PROJECT_NOT_FOUND,
	type Projects,
	type SpaceDocuments,
	setSpaceUsage,
	toProject,
} from "./projects";
import type { RunStreamItem } from "./read";
import type { Access, Actions, Move, Start, Views } from "./runs";
import type { Schedules } from "./schedules";
import { readServiceLog } from "./services";
import type { SpaceEngine } from "./space-engine";
import type { MovedProjects, ProjectsMove } from "./space-move";
import type { KeptFlow, KeptValue } from "./variables";

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
	runner: Pick<Runner, "isActive">;

	// --- projects, flows, kept values, node memory, answer costs (phase 3) ---
	projects: Projects;
	documents: SpaceDocuments;
	/** The ids of the project's runs. */
	runIdsOfProject(projectId: string): Promise<string[]>;
	listBranches(repoPath: string): Promise<Branches>;
	/** The flows of the Space's projects, for the Person who acts (`flows/space-flows.ts`). */
	flows(spaceId: string, personId?: string): SpaceFlows;
	/** The import on upgrade of this Device's Clone of the project, once. Never throws. */
	importClone(projectId: string): Promise<void>;
	/** The kept variables of a project's flows on this computer. */
	kept: {
		list(flow: KeptFlow): Promise<KeptValue[]>;
		reset(flow: KeptFlow, name: string): Promise<void>;
	};
	/** What the Since last run nodes of a project's flows saw, on this computer. */
	memory: {
		list(flow: MemoryFlow): Promise<NodeMemory[]>;
		forget(flow: MemoryFlow, node: string, scope?: string): Promise<void>;
	};
	/** What the answers of Night Shift's own agents cost in a Space, as this Replica has them. */
	answerCosts(spaceId: string, since?: number): Promise<AnswerCost[]>;
	/** A Space move (`projects-move.ts`). */
	moveProjects(move: ProjectsMove): Promise<MovedProjects>;

	// --- access, and the files of a run that other slices keep (R1) ---
	/** Opens a run for an actor: the one check of who may see or act on it (`runs/access`). */
	openRun: Access["openRun"];
	/** The files of run folders on this computer. */
	runFiles: Pick<RunFilesService, "list" | "file">;
	/** The artifacts kept on this computer. */
	artifacts: Pick<ArtifactStore, "list" | "file">;
	/** Hides the worktree paths of runs on Devices the actor does not own. */
	pathsFor(
		spaceId: string,
		actor: PersonActor | undefined,
	): Promise<<T extends WithPaths>(summary: T) => Promise<T>>;

	// --- views (R2) ---
	/** The views of the runs, for the readers that act for Night Shift (the Gates). */
	reads: Views["reads"];
	/** The reads of the runs (`runs/views`). The wire decides who opens a run (D6). */
	views: Views;

	// --- start (R3) ---
	/** A run's start, and the Devices a person chooses from (`runs/start`): each use case checks the Space itself. */
	start: Pick<Start, "startRun" | "listPlacements" | "listDevices">;

	// --- actions (R4), move (R5), gates (R6) ---
	/** Stop, answer, signal, move, resume, restart and run again (`runs/actions`). */
	actions: { act: Actions["actOnRun"] };
	/** The Devices a run can move to (`runs/move`). */
	moveTargets: Move["listMoveTargets"];

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
	const { ready, log, projects, documents, reads, actions, views } = deps;

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
	return function space(spaceId: string, actor?: PersonActor): SpaceEngine {
		/** The run in this Space, opened for the actor: Night Shift when there is none. */
		const open = (runId: string) =>
			deps.openRun(actor ?? NIGHT_SHIFT, { runId, spaceId });

		return {
			// --- projects (phase 3) ---
			async listProjects() {
				await ready;
				return withClones(spaceId, await projects.listInSpace(spaceId));
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

			async addProjectWithoutFolder(input) {
				await ready;
				const row = await projects.addWithoutFolder(input, spaceId);
				const [added] = await withClones(spaceId, [row]);
				if (!added) throw new Error("Could not add the project.");
				return added;
			},

			async useProjectFolder(projectId, repoPath) {
				await ready;
				const current = await projects.find(projectId, spaceId);
				// A run here works in the folder it has: a new one waits for its end.
				if (current.repoPath !== null) {
					await noActiveRun(projectId, "change its folder");
				}
				const row = await projects.useFolder(projectId, repoPath, spaceId);
				await deps.importClone(row.id);
				const [used] = await withClones(spaceId, [row]);
				if (!used) throw new Error("Could not use the folder.");
				return used;
			},

			async setUsage(enabled) {
				await ready;
				const document = await deps.documents.open(spaceId);
				if (document.hostedElsewhere) {
					throw new Refusal(
						"conflict",
						"Your Host keeps the settings of this Space. Change usage on your Host.",
					);
				}
				await setSpaceUsage(document, enabled);
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
					const status = (await log.state(runId)).status;
					if (status === "waiting") {
						throw new Refusal(
							"conflict",
							"A run of this project waits at a Gate. Answer the Gate or stop the run first.",
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
				// A project without a folder has no branches (ADR 22).
				const found = await projects.find(projectId, spaceId);
				if (!found.folder) return { current: null, local: [], remote: [] };
				const row = await projects.get(projectId, spaceId);
				return deps.listBranches(row.repoPath);
			},

			// --- kept values, node memory, flows, answer costs (phase 3) ---
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

			async listNodeMemory(projectId, flowName) {
				await ready;
				await projects.find(projectId, spaceId);
				return deps.memory.list({ spaceId, projectId, flowName });
			},

			async forgetNodeMemory(projectId, flowName, node, scope) {
				await ready;
				await projects.find(projectId, spaceId);
				await deps.memory.forget({ spaceId, projectId, flowName }, node, scope);
			},

			flows: deps.flows(spaceId, actor?.personId),

			async listAnswerCosts(since) {
				await ready;
				return deps.answerCosts(spaceId, since);
			},

			// --- views (R2): each read with the actor, Night Shift without one ---
			async projectRuns(read) {
				await ready;
				return views.listProjectRuns(actor ?? NIGHT_SHIFT, {
					spaceId,
					...(read !== undefined ? { read } : {}),
				});
			},

			async listRuns(input) {
				await ready;
				return views.listRuns(actor ?? NIGHT_SHIFT, { ...input, spaceId });
			},

			async getRun(runId) {
				await ready;
				return views.readRun(actor ?? NIGHT_SHIFT, { runId, spaceId });
			},

			async getStep(runId, stepId) {
				await ready;
				return views.readStep(actor ?? NIGHT_SHIFT, { runId, spaceId, stepId });
			},

			async stepTranscript(runId, stepId, signal) {
				await ready;
				return views.readStepTranscript(actor ?? NIGHT_SHIFT, {
					runId,
					spaceId,
					stepId,
					signal: AbortSignal.any([signal, deps.signal]),
				});
			},

			watchRun(runId, { signal: watching, afterSeq }) {
				// A disposed engine publishes nothing more on its bus: the watch
				// ends with it, so the watcher reconnects to the next engine.
				return watch(actor ?? NIGHT_SHIFT, {
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
				await open(runId);
				return deps.runFiles.list(runId);
			},

			async runFile(runId, path) {
				await ready;
				await open(runId);
				return deps.runFiles.file(runId, path);
			},

			// --- start (R3) ---
			async listDevices(projectId, forNode) {
				await ready;
				return deps.start.listDevices(actor ?? NIGHT_SHIFT, {
					spaceId,
					projectId,
					...(forNode !== undefined ? { forNode } : {}),
				});
			},

			async listPlacements(projectId) {
				await ready;
				return deps.start.listPlacements(actor ?? NIGHT_SHIFT, {
					spaceId,
					projectId,
				});
			},

			async startRun(input) {
				await ready;
				// Asked before the start: who may see the paths of the run.
				const shown = await deps.pathsFor(spaceId, actor);
				// As Night Shift until the doors hand their actor to `Engine.runs.start`
				// (lane R8): each door checks `run.start` itself and names its Person
				// in `startedBy`, and engine tests start runs for Persons who have no
				// Member row.
				return shown(
					await deps.start.startRun(NIGHT_SHIFT, { ...input, spaceId }),
				);
			},

			// --- actions (R4) ---
			async act(runId, request) {
				await ready;
				await actions.act(actor ?? NIGHT_SHIFT, {
					spaceId,
					runId,
					action: request,
				});
			},

			// --- move (R5) ---
			async listMoveTargets(runId) {
				await ready;
				return deps.moveTargets(actor ?? NIGHT_SHIFT, { spaceId, runId });
			},

			// --- gates (R6) ---
			async listGates() {
				await ready;
				return reads.listGates(spaceId);
			},

			async listAnsweredGates(since) {
				await ready;
				return reads.listAnsweredGates(spaceId, since);
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
