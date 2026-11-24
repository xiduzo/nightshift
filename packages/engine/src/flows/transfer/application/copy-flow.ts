import type { Permissions } from "@nightshift/auth";
import { loadFlowSource } from "@nightshift/flows";
import type { Access } from "../../../access";
import { type Actor, personOf } from "../../../contract";
import type { ProjectFlows } from "../../store";
import {
	namesOf,
	nameTaken,
	notValidFlow,
	type SavedFlow,
} from "../domain/flow-files";
import type { FlowUsage, SpaceProjects } from "./ports";

const SAVES_FLOWS: Permissions = { flow: ["save"] };

export type CopyFlowPorts = {
	access: Pick<Access, "openSpace">;
	projects: SpaceProjects;
	flows: Pick<ProjectFlows, "flows" | "save">;
	usage?: FlowUsage | undefined;
};

/**
 * Copies a flow into a project of the Space as `to.name`, a revision of
 * kind `copy` by the actor there. The flows it calls stay behind: the
 * issues say which ones the copy misses. Refuses a name that project has
 * already, and suggests a free one.
 */
export const copyFlow =
	(ports: CopyFlowPorts) =>
	async (
		actor: Actor,
		request: {
			spaceId: string;
			projectId: string;
			name: string;
			to: { projectId: string; name: string };
		},
	): Promise<SavedFlow> => {
		const { spaceId, projectId, name, to } = request;
		await ports.access.openSpace(actor, {
			spaceId: request.spaceId,
			need: SAVES_FLOWS,
		});
		await ports.projects.inSpace(projectId, spaceId);
		await ports.projects.inSpace(to.projectId, spaceId);
		const loaded = loadFlowSource(await ports.flows.flows(projectId), name);
		if (loaded.flow === null) throw notValidFlow(name);
		const taken = namesOf(await ports.flows.flows(to.projectId));
		if (taken.has(to.name)) throw nameTaken(to.name, taken);
		const issues = await ports.flows.save(to.projectId, to.name, loaded.flow, {
			kind: "copy",
			personId: personOf(actor) ?? undefined,
		});
		ports.usage?.note({ kind: "flow-created", from: "copy" });
		return { name: to.name, issues };
	};
