import { wireDashboard } from "./dashboard";
import type { Engine } from "./engine";

/**
 * The dashboard block of the engine's composition (`wire.ts`). Lane DB of
 * the hexagon series owns this file.
 *
 * Each port reads through the Space view of the actor (`space.ts`), as the
 * doors did before: the same reads, the same checks of who may read, and
 * the same words when one refuses.
 */
export function wireEngineDashboard(deps: { space: Engine["space"] }) {
	const view = deps.space;
	return wireDashboard({
		runs: {
			list: (actor, { spaceId, projectId }) =>
				projectId === undefined
					? view(spaceId, actor).listRuns()
					: view(spaceId, actor).listRuns({ projectId }),
			get: (actor, { spaceId, runId }) => view(spaceId, actor).getRun(runId),
		},
		flows: {
			list: (actor, { spaceId, projectId }) =>
				view(spaceId, actor).flows.list(projectId),
			revisions: (actor, { spaceId, projectId, name }) =>
				view(spaceId, actor).flows.revisions(projectId, name),
		},
		projects: {
			list: (actor, { spaceId }) => view(spaceId, actor).listProjects(),
		},
		answerCosts: {
			list: (actor, { spaceId, since }) =>
				view(spaceId, actor).listAnswerCosts(since),
		},
	});
}
