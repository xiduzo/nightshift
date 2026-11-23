import { type DeviceConfig, wireDeviceConfig } from "../device-config";

/** This computer's configuration over a test's Device document, loaded as the daemon loads it. */
export async function openConfigStores(
	options: Parameters<typeof wireDeviceConfig>[0],
): Promise<DeviceConfig> {
	const config = wireDeviceConfig(options);
	const { settings, connections, cliTools, profiles } = config;
	await Promise.all(
		[settings, connections, cliTools, profiles].map((store) => store.load()),
	);
	return config;
}
