import { type FlowPlace, policyFromSettings } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { connectionQueries } from "@/features/agents";
import { useHasFolder } from "@/features/projects";
import { runQueries } from "@/features/runs/flows-port";
import { settingsQueries } from "@/features/settings/queries";
import { useProjectFlows } from "../use-project-flows";
import { useCommandTools } from "./cli-tools-field";

/**
 * What the editor reads besides the draft: the project's other flows, the
 * settings (new-node defaults, run policy), the connections, the Devices
 * with the profiles a node may name, the CLI tools commands call, and
 * whether the project has a folder. Each part is undefined while it loads,
 * but the folder: true until the project says it has none. `place` holds
 * the facts the flow is checked in (`checkFlow`). A node's Device field
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
	// Every Device with the profiles a node may name, as the Host lists them.
	const devices = useQuery({
		...runQueries.devices(projectId),
		meta: { quietErrors: true },
	});
	// A node keeps a device's id: the canvas shows its name.
	const deviceNames = useMemo(
		() =>
			new Map(
				(devices.data ?? []).map((device) => [device.deviceId, device.name]),
			),
		[devices.data],
	);
	const cliTools = useCommandTools().refs;
	// A step that needs the project's folder warns in a project without one.
	const folder = useHasFolder(projectId);
	const place = useMemo(
		(): FlowPlace => ({
			flows: projectFlows.flows,
			name,
			devices: devices.data,
			connections: connections?.map((connection) => connection.name),
			cliTools,
			folder,
		}),
		[projectFlows.flows, name, devices.data, connections, cliTools, folder],
	);
	return {
		folder,
		deviceNames,
		projectFlows,
		nodeDefaults,
		policyDefaults,
		connections,
		place,
	};
}
