import type { AnswerCost } from "../../assistant";
import type { Actor } from "../../contract";
import type { FlowRevisionItem } from "../../flows";
import type { RunDetail, RunSummary } from "../../read";

/**
 * The runs of a Space as the actor may see them, project by project.
 * Each call checks who may read, as the Space view does.
 *
 * @filledBy engine/wire
 */
export type DashboardRuns = {
	/** The runs of the Space, or of one project of it. */
	list(
		actor: Actor,
		request: { spaceId: string; projectId?: string },
	): Promise<RunSummary[]>;
	/** One run with its steps. Throws when the actor may not read it, or it is not there. */
	get(
		actor: Actor,
		request: { spaceId: string; runId: string },
	): Promise<RunDetail>;
};

/**
 * The flows of a project, and the revisions of one flow.
 *
 * @filledBy engine/wire
 */
export type DashboardFlows = {
	list(
		actor: Actor,
		request: { spaceId: string; projectId: string },
	): Promise<{ name: string }[]>;
	revisions(
		actor: Actor,
		request: { spaceId: string; projectId: string; name: string },
	): Promise<FlowRevisionItem[]>;
};

/**
 * The projects of a Space, for the names of the dashboard over Spaces.
 *
 * @filledBy engine/wire
 */
export type DashboardProjects = {
	list(
		actor: Actor,
		request: { spaceId: string },
	): Promise<{ id: string; name: string }[]>;
};

/**
 * What the answers of Night Shift's own agents in a Space cost, since a time.
 *
 * @filledBy engine/wire
 */
export type AnswerCosts = {
	list(
		actor: Actor,
		request: { spaceId: string; since: number | undefined },
	): Promise<AnswerCost[]>;
};
