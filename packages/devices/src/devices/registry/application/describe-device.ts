import type { DeviceStore } from "./ports";

export type DescribeDevicePorts = { store: Pick<DeviceStore, "describe"> };

/** What a paired Device says of itself when it links. */
export type DescribeDevice = {
	id: string;
	name: string;
	dev: boolean;
	machine?: string | undefined;
};

/**
 * Records what a paired Device says of itself when it links: its name,
 * whether it is a development install, and the fingerprint of its
 * computer. A Device that says no fingerprint keeps the one it has. A
 * development install has none. Two Devices with one fingerprint stay as
 * they are.
 *
 * The Host asks it: the use case takes the request alone.
 */
export const describeDevice =
	(ports: DescribeDevicePorts) =>
	async (request: DescribeDevice): Promise<void> => {
		await ports.store.describe(request.id, {
			name: request.name,
			dev: request.dev,
			machine: request.dev ? null : request.machine,
		});
	};
