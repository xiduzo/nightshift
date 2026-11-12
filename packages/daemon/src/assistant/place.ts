/**
 * The place a flow is checked in, as the daemon reads it for the chat and
 * Suggest: the facts the editor reads, from the same sources.
 */
import type { SpaceEngine, SpaceFlows } from "@nightshift/engine";
import type {
	CliToolStore,
	ConnectionStore,
} from "@nightshift/engine/device-config";
import type { FlowPlace } from "@nightshift/flows";

export type PlaceDeps = {
	/** The project's flows and the Devices of its Space, as the Person sees them. */
	space: Pick<SpaceEngine, "listDevices"> & { flows: Pick<SpaceFlows, "map"> };
	cliTools: Pick<CliToolStore, "list">;
	connections: Pick<ConnectionStore, "list">;
	/** Whether the project has no folder (ADR 22). Without it: every project has one. */
	withoutFolder?: (projectId: string) => Promise<boolean>;
};

/**
 * The place the project's flow `name` is checked in: the project's flows,
 * the Devices of the Space with their profiles, this computer's
 * connections and CLI tools, and whether the project has a folder. A fact
 * that does not load is left out, as in the editor: its checks wait.
 */
export async function flowPlace(
	deps: PlaceDeps,
	projectId: string,
	name: string,
): Promise<FlowPlace> {
	const [flows, devices, withoutFolder] = await Promise.all([
		deps.space.flows.map(projectId).catch(() => undefined),
		deps.space.listDevices(projectId).catch(() => undefined),
		deps.withoutFolder?.(projectId).catch(() => undefined),
	]);
	return {
		flows,
		name,
		devices,
		connections: deps.connections.list().map((connection) => connection.name),
		cliTools: deps.cliTools.list().map((tool) => ({
			name: tool.name,
			program: tool.program,
			signsIn: tool.login !== null,
		})),
		folder: withoutFolder === undefined ? undefined : !withoutFolder,
	};
}
