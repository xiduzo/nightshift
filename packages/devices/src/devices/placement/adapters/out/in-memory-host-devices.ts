import type { OwnDevice } from "@nightshift/engine";
import type { HostDevices } from "../../application/ports";

/** A Host that lists these Devices, refuses with this error, or cannot be reached. */
export function inMemoryHostDevices(host: {
	devices?: OwnDevice[];
	refuses?: Error;
	unreachable?: boolean;
}): HostDevices {
	return {
		async list() {
			if (host.refuses) throw host.refuses;
			return host.unreachable ? null : (host.devices ?? []);
		},
	};
}
