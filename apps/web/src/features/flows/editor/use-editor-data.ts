import { policyFromSettings } from "@nightshift/flows";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { connectionQueries, profileQueries } from "@/features/agents";
import { settingsQueries } from "@/features/settings/queries";
import { useProjectFlows } from "../use-project-flows";

/**
 * What the editor reads besides the draft: the project's other flows, the
 * settings (new-node defaults, run policy), the connections and the Agent
 * Profiles. Each part is undefined while it loads. A node's Device field
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
	const daemonProfiles = useQuery(profileQueries.list());
	const projectProfiles = useQuery({
		...profileQueries.project(projectId),
		meta: { quietErrors: true },
	});
	// This computer's and the project's: a run finds a profile in either.
	const profileNames = useMemo(
		() =>
			daemonProfiles.data && (projectProfiles.data || projectProfiles.isError)
				? [
						...daemonProfiles.data.map((profile) => profile.name),
						...(projectProfiles.data?.profiles ?? []).map((p) => p.name),
					]
				: undefined,
		[daemonProfiles.data, projectProfiles.data, projectProfiles.isError],
	);
	return {
		projectFlows,
		nodeDefaults,
		policyDefaults,
		connections,
		connectionNames,
		profileNames,
	};
}
