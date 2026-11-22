import { inMemoryDeviceAuthorizations } from "./in-memory-device-authorizations";

/**
 * `inMemoryPairingPorts`, which gives a use-case test every port of
 * pairing at once. Test code: production code never imports this file.
 */

/**
 * Every port of pairing in memory at once: where each use-case test
 * starts. A request's Person is its `x-person` header.
 */
export function inMemoryPairingPorts() {
	return {
		deviceAuthorizations: inMemoryDeviceAuthorizations(),
	};
}
