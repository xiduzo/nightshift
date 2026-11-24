import type { Flow } from "@nightshift/flows";
import { dismissProjectFlowNotice } from "../../application/dismiss-project-flow-notice";
import { listProjectFlowNotices } from "../../application/list-project-flow-notices";
import { listProjectFlowRevisions } from "../../application/list-project-flow-revisions";
import { readProjectFlows } from "../../application/read-project-flows";
import { readProjectSchedules } from "../../application/read-project-schedules";
import { removeProjectFlow } from "../../application/remove-project-flow";
import {
	type SaveFlowOptions,
	saveProjectFlow,
} from "../../application/save-project-flow";
import { saveProjectSchedules } from "../../application/save-project-schedules";
import type { ProjectFlows } from "../../wire";
import {
	inMemoryProjectSpaces,
	inMemoryStorePorts,
} from "./in-memory-neighbours";

/**
 * The flows of the projects over in-memory adapters: the real use cases, on
 * the Device `laptop` at 1000, with the projects a test puts in their
 * Spaces. The use-case test of every slice that reads or saves a flow takes
 * this one. Test code: production code never imports this file.
 */
export function inMemoryFlows(
	spaces: Record<string, string> = { project: "space" },
) {
	const ports = {
		...inMemoryStorePorts(),
		projects: inMemoryProjectSpaces(spaces),
	};
	const flows = readProjectFlows(ports);
	const save = saveProjectFlow(ports);
	const remove = removeProjectFlow(ports);
	const revisions = listProjectFlowRevisions(ports);
	const schedules = readProjectSchedules(ports);
	const saveSchedules = saveProjectSchedules(ports);
	const notices = listProjectFlowNotices(ports);
	const dismissNotice = dismissProjectFlowNotice(ports);
	/** Every flow saved, in order. */
	const saves: ({
		projectId: string;
		name: string;
		flow: Flow;
	} & SaveFlowOptions)[] = [];
	const bound = {
		flows: (projectId) => flows({ projectId }),
		async save(
			projectId: string,
			name: string,
			flow: Flow,
			options: SaveFlowOptions = {},
		) {
			const issues = await save({ projectId, name, flow, ...options });
			saves.push({ projectId, name, flow, ...options });
			return issues;
		},
		remove: (projectId, name) => remove({ projectId, name }),
		revisions: (projectId, name) => revisions({ projectId, name }),
		schedules: (projectId, options = {}) =>
			schedules({ projectId, ...options }),
		saveSchedules: (projectId, list) =>
			saveSchedules({ projectId, schedules: list }),
		notices: (projectId) => notices({ projectId }),
		dismissNotice: (projectId, noticeId) =>
			dismissNotice({ projectId, noticeId }),
	} satisfies Partial<ProjectFlows>;
	return { ...bound, store: ports.store, saves };
}
