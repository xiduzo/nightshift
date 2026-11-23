import { HostUnreachableError } from "@nightshift/engine";
import type { DeviceLinks, HostLinks } from "../../../../links";
import type { HostCalls } from "../../application/ports";

/** The calls of this computer's Hosts over its links (`HostLinks`, `DeviceLinks`). */
export function linkHostCalls(deps: {
	hostLinks: Pick<HostLinks, "home">;
	/** Lazy: the links are made after this. */
	links(): Pick<DeviceLinks, "get">;
}): HostCalls {
	return {
		async home() {
			const home = await deps.hostLinks.home();
			return home ? { hostId: home.hostId, personId: home.personId } : null;
		},
		async ask(hostId, onHost, options) {
			const link = deps.links().get(hostId);
			if (!link) throw new HostUnreachableError();
			return link.call(onHost, {
				...options,
				late: () => new HostUnreachableError(),
			});
		},
	};
}
