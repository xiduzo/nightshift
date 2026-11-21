import type { ProjectRef } from "../../../contract";
import {
	type KnownSecrets,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";
import type { listSecretValues } from "./list-secret-values";

export type ListExportValuesPorts = {
	projects: Reach<Pick<ProjectSecrets, "kept">>;
	known: Pick<KnownSecrets, "warnOnce">;
	secretValues: ReturnType<typeof listSecretValues>;
};

/** The Project of the exported run. */
export type ListExportValues = { project: ProjectRef };

/**
 * What an exported run of the Project takes out: the secret values
 * (`listSecretValues`), and the Project's values when this computer keeps
 * them. Where another Host keeps them, the steps' output has them as
 * `•••` already.
 */
export const listExportValues =
	(ports: ListExportValuesPorts) =>
	async ({ project }: ListExportValues): Promise<string[]> => {
		const values = await ports.secretValues({});
		if (ports.projects === undefined) return values;
		try {
			return [
				...new Set([
					...values,
					...(await reachProjects(ports.projects).kept(project)),
				]),
			];
		} catch (error) {
			ports.known.warnOnce("read", error, "Project");
			return values;
		}
	};
