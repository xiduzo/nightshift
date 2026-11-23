import type { DeviceCopy } from "@nightshift/engine/device-config";
import type { DeviceCopiesPort, SpacePeople } from "../../application/ports";

export function inMemorySpacePeople(
	state: {
		personIn?: string;
		personalId?: string | null;
		names?: Map<string, string>;
		keptByHome?: boolean;
	} = {},
): SpacePeople {
	return {
		personInSpace: async () => state.personIn ?? "person",
		personalSpaceIdBySlug: async () => state.personalId ?? null,
		personNames: async (ids) => {
			const map = new Map<string, string>();
			for (const id of ids) map.set(id, state.names?.get(id) ?? id);
			return map;
		},
		keptByHomeHost: async () => state.keptByHome ?? false,
	};
}

export function inMemoryDeviceCopies(
	list: DeviceCopy[] = [],
): DeviceCopiesPort {
	return { list: async () => list };
}
