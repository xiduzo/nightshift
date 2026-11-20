import { Refusal } from "@nightshift/refusal";
import type { Actor } from "../../../contract";
import {
	defineProject,
	PROJECT_NOT_FOUND,
	type ProjectLog,
	type ProjectStore,
	type SpaceProjects,
} from "../../keep";
import { noActiveRun, SLEEPS, WAITS_AT_GATE } from "../domain/words";
import type { ProjectRuns } from "./ports";

export type RemoveProjectPorts = {
	store: Pick<ProjectStore, "find" | "row">;
	spaceProjects: Pick<SpaceProjects, "define">;
	projectLog: Pick<ProjectLog, "append">;
	runs: ProjectRuns;
};

/** The project to remove. */
export type RemoveProject = { spaceId: string; projectId: string };

/**
 * Marks a project of the Space removed. Its runs, events, worktrees and
 * Clones stay: a person may still need them. Refused while a run of it
 * runs a step here, waits at a Gate or sleeps. The door checks the
 * person's role.
 */
export const removeProject =
	(ports: RemoveProjectPorts) =>
	async (_actor: Actor, request: RemoveProject): Promise<void> => {
		const { spaceId, projectId } = request;
		const notFound = () => new Refusal("not-found", PROJECT_NOT_FOUND);
		if (!(await ports.store.find(projectId, spaceId))) throw notFound();
		const runIds = await noActiveRun(
			ports.runs,
			projectId,
			"remove the project",
		);
		for (const runId of runIds) {
			const status = await ports.runs.status(runId);
			if (status === "waiting") throw new Refusal("conflict", WAITS_AT_GATE);
			if (status === "sleeping") throw new Refusal("conflict", SLEEPS);
		}
		const row = await ports.store.row(projectId);
		if (!row) throw notFound();
		await defineProject(
			(r, change) => ports.spaceProjects.define(r, change),
			row,
			{ removed: true },
		);
		await ports.projectLog.append({
			type: "ProjectRemoved",
			payload: { projectId },
		});
	};
