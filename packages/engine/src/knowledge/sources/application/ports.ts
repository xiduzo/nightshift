import type { Permissions } from "@nightshift/auth";
import type { Flow, FlowIssue, Schedule } from "@nightshift/flows";
import type { Actor } from "../../../contract";
import type { KnowledgeListing } from "../../files";
import type { FlowMap } from "../domain/source-flows";
import type { SourceRun } from "../domain/syncs";

/**
 * The driven ports of knowledge/sources. A port of its own has a real adapter,
 * an in-memory adapter and a contract suite in `adapters/out/`. Another
 * slice or package fills a port with `@filledBy`: the composition of the
 * package passes it to `wireSources`.
 */

/**
 * The Space as the person who asks sees it, as far as a source needs it:
 * the API passes its `SpaceEngine` in with each request. The engine that
 * walks runs reads this knowledge, so the knowledge cannot name it.
 * @filledBy engine/wire
 */
export type SourcesSpace<Run extends SourceRun = SourceRun> = {
	flows: {
		map(projectId: string): Promise<FlowMap>;
		save(projectId: string, name: string, flow: Flow): Promise<FlowIssue[]>;
		remove(projectId: string, name: string): Promise<void>;
	};
	listSchedules(projectId: string): Promise<{ schedules: readonly unknown[] }>;
	saveSchedules(
		projectId: string,
		schedules: readonly Schedule[],
		timeZone?: string,
	): Promise<unknown>;
	listRuns(input: { projectId: string; limit: number }): Promise<Run[]>;
	startRun(input: {
		projectId: string;
		flowName: string;
		startedBy: string;
	}): Promise<Run>;
	listDevices(projectId: string): Promise<{ deviceId: string; name: string }[]>;
};

/**
 * This Device's knowledge: the files after a reconcile, and the removal of
 * a folder for every Device of the Space.
 * @filledBy engine/knowledge
 */
export type SourceFiles = {
	listing(projectId: string): Promise<KnowledgeListing>;
	/** Removes the files of a folder. Returns how many it removed. */
	removeFolder(projectId: string, folder: string): Promise<number>;
};

/**
 * Whether the secret of the project's page reader is saved where this
 * computer finds it.
 * @filledBy engine/knowledge
 */
export type ReaderReady = {
	ready(projectId: string): Promise<boolean>;
};

/** A wait of some time: how long a list waits for the names of other computers. */
export type Wait = {
	/** Resolves after `ms`. */
	wait(ms: number): Promise<void>;
};

/**
 * Who may act in a Space for this knowledge request.
 * @filledBy engine/runs
 */
export type SourcesAccess = {
	openSpace(
		actor: Actor,
		request: { spaceId: string; need?: Permissions },
	): Promise<void>;
};
