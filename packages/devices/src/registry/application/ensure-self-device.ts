import {
	type SelfDevice,
	type SelfDeviceHost,
	selfDeviceHost,
} from "../domain/self-device-host";
import type { DeviceStore, ThisComputer } from "./ports";

export type EnsureSelfDevicePorts = {
	store: Pick<DeviceStore, "self" | "setFacts" | "addSelf">;
	computer: ThisComputer;
	/** A new random id: the wire draws it. */
	newId: () => string;
};

/**
 * What the request asks for: the default name and platform (`host`), else
 * the default of this computer, with "(dev)" for a development install.
 */
export type EnsureSelfDevice = { host?: SelfDeviceHost; dev?: boolean };

/**
 * This computer's Device, made when there is none. A name or platform the
 * migration left blank is filled in from the default, and so is a stale
 * default name (`SelfDeviceHost.stale`).
 *
 * Night Shift asks it: the use case takes the request alone.
 */
export const ensureSelfDevice = (ports: EnsureSelfDevicePorts) => {
	const { store, computer } = ports;
	async function ensure(host: SelfDeviceHost): Promise<SelfDevice> {
		const row = await store.self();
		if (row) {
			// A default that a newer default replaces: a container id, or the host
			// name from before NIGHTSHIFT_DEVICE_NAME was set.
			if (row.name !== "" && host.stale?.(row.name)) {
				await store.setFacts(row.id, { name: host.name });
				return ensure(host);
			}
			if (row.name !== "" && row.platform !== "") {
				return { id: row.id, name: row.name };
			}
			const filled = {
				name: row.name || host.name,
				platform: row.platform || host.platform,
			};
			await store.setFacts(row.id, filled);
			return { id: row.id, name: filled.name };
		}
		// Two first starts at once: the unique index on `self` keeps one row.
		await store.addSelf({
			id: ports.newId(),
			name: host.name,
			platform: host.platform,
		});
		return ensure(host);
	}
	return async (request: EnsureSelfDevice = {}): Promise<SelfDevice> =>
		ensure(
			request.host ??
				selfDeviceHost({
					env: computer.env(),
					hostName: computer.hostName(),
					container: computer.inContainer(),
					platform: computer.platform(),
					dev: request.dev,
				}),
		);
};
