import type { SecretList, SecretView } from "../../../secrets";
import type {
	CliToolStore,
	Connection,
	ConnectionStore,
	ProfileStore,
} from "../../../settings";
import { type FlowRef, flowUse, readSpaceFlows } from "../domain/flow-use";
import {
	type Asker,
	coverage,
	profilesNaming,
	secretUsers,
	sharedNames,
} from "../domain/secret-users";
import type { SpaceViews, ThisDevice, ToolLogins } from "./ports";

export type ListConnectionUsePorts = {
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

/** A connection, with the flows and the profiles that name it. */
export type ConnectionInUse = Connection & {
	usedBy: FlowRef[];
	profiles: string[];
};

/**
 * A secret of this computer or the Person's, with what uses it here.
 * `usedBy` holds the connections that read it.
 */
export type SecretInUse = SecretView & {
	/** The flows that use it (`secretUsers`). */
	flows: FlowRef[];
	/** The CLI tools whose logins read it. */
	tools: string[];
	/** The flows a webhook schedule with this secret starts. */
	webhooks: FlowRef[];
};

/**
 * This computer's connections, and the secrets of this computer and of
 * its Person (Personal), with what uses each, in the Space of the Person
 * who asks. `personal` says whether the Personal secrets could be read
 * now. A flow whose project or Space has a secret's name reads that
 * value, not this computer's.
 */
export const listConnectionUse =
	(ports: ListConnectionUsePorts) =>
	async (request: {
		at: Asker;
	}): Promise<{
		connections: ConnectionInUse[];
		secrets: SecretInUse[];
		personal: SecretList["personal"];
	}> => {
		const { at } = request;
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
		const listed = await ports.connections.secrets(users.named);
		const rows = listed.secrets.map((secret) => ({
			secret,
			of: users.of(secret.name),
		}));
		const covers = await coverage(
			sharedNames({
				space: () => ports.connections.spaceSecrets(at.spaceId, at.personId),
				project: (projectId) =>
					ports.connections.projectSecrets(
						{ spaceId: at.spaceId, projectId },
						at.personId,
					),
			}),
			rows.flatMap(({ of }) => [...of.flows, ...of.webhooks]),
		);
		const secrets: SecretInUse[] = [];
		for (const { secret, of } of rows) {
			// A flow whose project or Space has the name reads that value.
			const covered = (flow: FlowRef) =>
				covers.get(flow.projectId)?.has(secret.name) === true;
			const flows = of.flows.filter((flow) => !covered(flow));
			const webhooks = of.webhooks.filter((flow) => !covered(flow));
			// The connections and CLI tools that read it stay while no flow is
			// known to use the name, or one that does needs this value.
			const holders = of.flows.length === 0 || flows.length > 0;
			const usedBy = holders ? secret.usedBy : [];
			const tools = holders ? [...of.tools] : [];
			const needed =
				secret.saved ||
				secret.inEnv ||
				usedBy.length > 0 ||
				tools.length > 0 ||
				flows.length > 0 ||
				webhooks.length > 0;
			if (needed) secrets.push({ ...secret, usedBy, flows, tools, webhooks });
		}
		const profiles = ports.profiles.list();
		return {
			// After the secrets: a connection's variables read the Personal names as listed now.
			connections: ports.connections.list().map((c) => ({
				...c,
				usedBy: use.connections.get(c.name) ?? [],
				profiles: profilesNaming(profiles, (p) => p.connections, c.name),
			})),
			secrets,
			personal: listed.personal,
		};
	};
