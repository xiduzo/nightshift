import type { ProjectRef } from "../../../contract";
import {
	type KnownSecrets,
	type ProjectSecrets,
	type Reach,
	reachProjects,
} from "../../scopes";
import type { noteSecretUse } from "./note-secret-use";
import type { resolveSecrets } from "./resolve-secrets";

export type ReadWebhookSecretPorts = {
	projects: Reach<Pick<ProjectSecrets, "kept">>;
	known: Pick<KnownSecrets, "warnOnce">;
	resolve: ReturnType<typeof resolveSecrets>;
	noteUse: ReturnType<typeof noteSecretUse>;
};

/** The webhook's secret name, and the Project of its schedule. */
export type ReadWebhookSecret = { name: string; project: ProjectRef };

/**
 * A webhook's secret: the Project's when this computer keeps it, then as
 * `readSecret`. No step asks for it, so no value comes from another Host.
 * Undefined while the Project's secrets cannot be read here.
 */
export const readWebhookSecret =
	(ports: ReadWebhookSecretPorts) =>
	async ({ name, project }: ReadWebhookSecret): Promise<string | undefined> => {
		if (ports.projects !== undefined) {
			try {
				const [value] = await reachProjects(ports.projects).kept(project, [
					name,
				]);
				if (value !== undefined) {
					ports.noteUse([name]);
					return value;
				}
			} catch (error) {
				ports.known.warnOnce("read", error, "Project");
				return undefined;
			}
		}
		const value = (await ports.resolve({ names: [name] })).vars[name];
		if (value !== undefined) ports.noteUse([name]);
		return value;
	};
