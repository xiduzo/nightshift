import type { Database } from "@nightshift/db";
import type { Access } from "./access";
import type { DeviceDirectory } from "./contract";
import type { FlowDocuments } from "./documents";
import type { EngineOptions } from "./engine-options";
import {
	type FlowTransfer,
	type ProjectFlows,
	wireEditing,
	wireFlows,
	wireStore,
	wireTransfer,
} from "./flows";
import type { RunLog } from "./log";
import { forgetMemory, listMemory } from "./memory";
import type { Projects } from "./projects";
import { namesOf } from "./read";
import { listKeptValues, resetKeptValue } from "./variables";

/**
 * The flows block of the engine's composition (`wire.ts`): the flows and
 * schedules of every project in its flow document (`flows/store/`),
 * and the moves of flows (`flows/transfer/`): a Person's export, import and
 * copy. It comes after the projects block
 * (`wire-projects.ts`), whose `projects` it takes.
 *
 * It gives `projectFlows` (with the merge of Personal) and `transfer`.
 */
export function wireEngineFlows(deps: {
	log: RunLog;
	flowDocuments: FlowDocuments;
	projects: Pick<Projects, "find">;
	/** The engine is ready: a Person's verb waits for it. Made after this block. */
	ready: () => Promise<unknown>;
	options: Pick<EngineOptions, "usage">;
	now(): number;
	access: Pick<Access, "openSpace">;
}) {
	const { log: runLog, flowDocuments, projects, now } = deps;
	/** The flows and schedules of every project: its flow document (ADR 2). */
	const { merges, ...stored } = wireStore({
		documents: flowDocuments,
		project: (projectId) => projects.find(projectId),
		deviceId: () => runLog.walkerId(),
		now,
	});
	const usage = deps.options.usage;
	const transfer = wireTransfer({
		access: deps.access,
		clock: now,
		merges,
		projects: {
			async inSpace(projectId, spaceId) {
				await deps.ready();
				await projects.find(projectId, spaceId);
			},
		},
		flows: stored,
		...(usage ? { usage } : {}),
	});
	/** The flows of every project, and the merge of one Project's flows into another's (the merge of Personal). */
	const projectFlows = {
		...stored,
		planMerge: (
			source: string,
			destination: string,
			persons?: Readonly<Record<string, string>>,
		) =>
			transfer.planFlowMerge({
				source,
				destination,
				...(persons ? { persons } : {}),
			}),
		merge: (
			source: string,
			destination: string,
			options: {
				persons?: Readonly<Record<string, string>>;
				apart?: string;
			} = {},
		) =>
			transfer.mergeFlows({
				source,
				destination,
				...(options.persons ? { persons: options.persons } : {}),
				...(options.apart === undefined ? {} : { apart: options.apart }),
			}),
	};
	return { projectFlows, transfer };
}

/**
 * The flows part of the Space view (`space.ts`): what a Person does with
 * the flows of a Space (`flows/editing/`, bound here once), and the
 * `SpaceFlows` of each Space over it and the moves (`transfer`). It comes
 * after `ready`, which each use case waits for before it checks the
 * project's Space.
 *
 * It gives `flows` (the `SpaceFlows` of a Space for an actor) and
 * `editing` (the kept values and the node memory).
 */
export function wireEngineSpaceFlows(deps: {
	db: Database;
	ready: Promise<unknown>;
	directory: DeviceDirectory;
	projects: Pick<Projects, "find">;
	projectFlows: ProjectFlows;
	transfer: FlowTransfer;
	options: Pick<EngineOptions, "usage">;
	access: Pick<Access, "openSpace">;
}) {
	const { db, ready, projects, projectFlows } = deps;
	const usage = deps.options.usage;
	const editing = wireEditing({
		access: deps.access,
		projects: {
			async inSpace(projectId, spaceId) {
				await ready;
				await projects.find(projectId, spaceId);
			},
		},
		flows: projectFlows,
		names: {
			persons: (ids) => namesOf(db, ids),
			devices: (ids) => deps.directory.names(ids),
		},
		...(usage ? { usage } : {}),
		kept: {
			list: (flow) => listKeptValues(db, flow),
			reset: (flow, name) => resetKeptValue(db, flow, name),
		},
		memory: {
			list: (flow) => listMemory(db, flow),
			forget: (flow, node, scope) => forgetMemory(db, flow, node, scope),
		},
	});
	const flows = wireFlows({ editing, transfer: deps.transfer });
	return { flows, editing };
}
