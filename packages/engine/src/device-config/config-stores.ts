import { type CliToolStore, createCliToolStore } from "./cli-tools";
import {
	type ConnectionStore,
	createConnectionStore,
	type PersonalSecrets,
	type ProjectSecrets,
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
	/** Where the secrets saved for this computer go (`secretStore`). */
	secrets: SecretBackend;
	/**
	 * The Person's Personal secrets (ADR 13), read at each use. Null until
	 * the devices start. Without it, this computer has no Personal scope.
	 */
	personal?: () => PersonalSecrets | null;
	/**
	 * The secrets of the Projects (ADR 13), read at each use. Null until
	 * the devices start. Without it, this computer has no Project scope.
	 */
	projects?: () => ProjectSecrets | null;
}): Promise<ConfigStores> {
	const { document, env, secrets, personal, projects } = options;
	const settings = createSettingsStore({ document, env });
	const stores: ConfigStores = {
		settings,
		connections: createConnectionStore({
			document,
			env,
			secrets,
			// The Secret scope rule reads "Be a Host" from the settings (ADR 18).
			host: () => settings.current().host,
			...(personal ? { personal } : {}),
			...(projects ? { projects } : {}),
		}),
		cliTools: createCliToolStore({ document }),
		profiles: createProfileStore({ document }),
	};
	await Promise.all(Object.values(stores).map((store) => store.load()));
	return stores;
}
