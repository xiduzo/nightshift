import { type DeviceConfig, wireSettings } from "../settings";

/** This computer's configuration over a test's Device document, loaded as the daemon loads it. */
export async function openConfigStores(
	options: Parameters<typeof wireSettings>[0],
): Promise<DeviceConfig> {
	const config = wireSettings(options);
	const { settings, connections, cliTools, profiles } = config;
	await Promise.all(
		[settings, connections, cliTools, profiles].map((store) => store.load()),
	);
	return config;
}
