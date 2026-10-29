import { type CliToolStore, createCliToolStore } from "./cli-tools";
import {
	type ConnectionStore,
	createConnectionStore,
	type SecretBackend,
} from "./connections";
import type { DeviceDocument } from "./device-document";
import { createProfileStore, type ProfileStore } from "./profiles";
import { createSettingsStore, type SettingsStore } from "./settings";

/** The stores of the configuration, as the API's context holds them. */
export type ConfigStores = {
	settings: SettingsStore;
	connections: ConnectionStore;
	cliTools: CliToolStore;
	profiles: ProfileStore;
};

/**
 * This computer's configuration: the four stores over its Device
 * document, loaded. A remote edit of the document applies at once.
 */
export async function openConfigStores(options: {
	document: DeviceDocument;
	/** The fallback of every setting and every `${NAME}`: the environment. */
	env: Readonly<Record<string, string | undefined>>;
	/** Where the secrets saved on the Connections page go (`secretStore`). */
	secrets: SecretBackend;
}): Promise<ConfigStores> {
	const { document, env, secrets } = options;
	const stores: ConfigStores = {
		settings: createSettingsStore({ document, env }),
		connections: createConnectionStore({ document, env, secrets }),
		cliTools: createCliToolStore({ document }),
		profiles: createProfileStore({ document }),
	};
	await Promise.all(Object.values(stores).map((store) => store.load()));
	return stores;
}
