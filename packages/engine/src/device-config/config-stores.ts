import { type ConfigStores, wireDeviceConfig } from "./wire";

export type { ConfigStores } from "./wire";

/**
 * This computer's configuration: the four stores over its Device
 * document (`wireDeviceConfig`), loaded. A remote edit of the document
 * applies at once.
 */
export async function openConfigStores(
	options: Parameters<typeof wireDeviceConfig>[0],
): Promise<ConfigStores> {
	const stores = wireDeviceConfig(options);
	await Promise.all(Object.values(stores).map((store) => store.load()));
	return stores;
}
