import { type ProfileRef, policyFromSettings } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { connectionQueries } from "@/features/agents";
import { runQueries } from "@/features/runs/flows-port";
import { settingsQueries } from "@/features/settings/queries";
import { useProjectFlows } from "../use-project-flows";
import { useCommandTools } from "./cli-tools-field";

/**
 * What the editor reads besides the draft: the project's other flows, the
 * settings (new-node defaults, run policy), the connections and each
 * Device's profiles a node may name, and the CLI tools commands call. Each
 * part is undefined while it loads. A node's Device field
 * asks for the devices that node may name itself.
 */
export function useEditorData(projectId: string, name: string) {
	// The other flow files, for Call nodes. The draft stands in for this one.
	const projectFlows = useProjectFlows(projectId, name);
	// The daemon's settings (new-node defaults, run policy) and connections.
	const settings = useQuery(settingsQueries.get());
	const daemonConnections = useQuery(connectionQueries.list());
	const nodeDefaults = settings.data?.values;
	const policyDefaults = useMemo(
		() => nodeDefaults && policyFromSettings(nodeDefaults),
		[nodeDefaults],
	);
	const connections = daemonConnections.data?.connections;
	const connectionNames = useMemo(
		() => connections?.map((connection) => connection.name),
		[connections],
	);
	// Every Device's profiles a node may name, as the Host lists them.
	const devices = useQuery({
		...runQueries.devices(projectId),
		meta: { quietErrors: true },
	});
	const profileRefs = useMemo(
		() =>
			devices.data && {
				known: devices.data.flatMap((device): ProfileRef[] =>
					(device.profiles ?? []).map((profile) => ({
						device: device.deviceId,
						profile: profile.id,
					})),
				),
				untoldDevices: devices.data
					.filter((device) => device.profiles === undefined)
					.map((device) => device.deviceId),
			},
		[devices.data],
	);
	const cliTools = useCommandTools().refs;
	return {
		projectFlows,
		nodeDefaults,
		policyDefaults,
		connections,
		connectionNames,
		profileRefs,
		cliTools,
	};
}
