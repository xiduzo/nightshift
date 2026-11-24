import { Refusal } from "@nightshift/refusal";
import type { ProjectSecretName } from "../../../secrets";
import type {
	CliToolStore,
	ConnectionStore,
	ProfileStore,
} from "../../../settings";
import { type FlowRef, flowUse, readSpaceFlows } from "../domain/flow-use";
import {
	type Asker,
	type SecretOwner,
	secretUsers,
} from "../domain/secret-users";
import type { SpaceViews, ThisDevice, ToolLogins } from "./ports";

export type ListSharedSecretUsePorts = {
	device: ThisDevice;
	spaces: SpaceViews;
	connections: Pick<
		ConnectionStore,
		"list" | "secrets" | "projectSecrets" | "spaceSecrets"
	>;
	cliTools: Pick<CliToolStore, "list">;
	profiles: Pick<ProfileStore, "list">;
	logins: ToolLogins;
};

/** A secret of a project or of the Space, with what uses it, by name. */
export type SharedSecretInUse = ProjectSecretName & {
	/** The flows that use it (`secretUsers`): of the project, for a project's secret. */
	flows: string[];
	/** The CLI tools of this computer whose logins read it. */
	tools: string[];
	/** The flows a webhook schedule with this secret starts. */
	webhooks: string[];
};

/**
 * The secrets of a project or of the Space, with what uses each, as the
 * Person who asks may see them. Null: the Host that keeps the Space
 * cannot be reached now, or is older.
 */
export const listSharedSecretUse =
	(ports: ListSharedSecretUsePorts) =>
	async (request: {
		at: Asker;
		owner: SecretOwner;
	}): Promise<SharedSecretInUse[] | null> => {
		const { at, owner } = request;
		let listed: ProjectSecretName[];
		try {
			listed =
				owner === "space"
					? await ports.connections.spaceSecrets(at.spaceId, at.personId)
					: await ports.connections.projectSecrets(
							{ spaceId: at.spaceId, projectId: owner.projectId },
							at.personId,
						);
		} catch (error) {
			if (error instanceof Refusal && error.kind === "unavailable") {
				return null;
			}
			throw error;
		}
		const use = flowUse(await readSpaceFlows(ports.spaces.open(at)));
		const users = secretUsers(
			{
				deviceId: ports.device.id,
				profiles: ports.profiles.list(),
				connections: ports.connections.list(),
				tools: ports.cliTools.list().map((tool) => ({
					name: tool.name,
					logins: tool.login ? ports.logins.references(tool.login) : [],
				})),
			},
			use,
		);
		/** The names of the flows, each once and sorted: of the project, for a project's secret. */
		const names = (flows: readonly FlowRef[]) =>
			[
				...new Set(
					flows
						.filter(
							(flow) => owner === "space" || flow.projectId === owner.projectId,
						)
						.map((flow) => flow.flowName),
				),
			].sort();
		return listed.map((secret) => {
			const of = users.of(secret.name);
			return {
				...secret,
				flows: names(of.flows),
				tools: [...of.tools].sort(),
				webhooks: names(of.webhooks),
			};
		});
	};
