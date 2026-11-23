import type { DeviceLinks, HostLinks } from "../../links";
import { linkHostCalls } from "./adapters/out/link-host-calls";
import type { HostCalls } from "./application/ports";

/**
 * The wiring of the calls: the one place that builds the calls of this
 * computer's Hosts over its links.
 */

/** What the package gives the calls: this computer's links to its Hosts. */
export type CallsDeps = {
	hostLinks: Pick<HostLinks, "home">;
	/** Lazy: the links are made after this. */
	links(): Pick<DeviceLinks, "get">;
};

export function wireCalls(deps: CallsDeps): HostCalls {
	return linkHostCalls(deps);
}
