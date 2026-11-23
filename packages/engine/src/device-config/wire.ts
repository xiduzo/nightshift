import { HARNESS_LABELS } from "@nightshift/agents/harness-facts";
import { findProgram } from "@nightshift/agents/types";
import type { DeviceDocument } from "../documents";
import type { PersonalSecrets, ProjectSecrets } from "../secrets";
import { type CliToolStore, wireCliTools } from "./cli-tools";
import {
	type ConnectionStore,
	type SecretBackend,
	type SecretEdits,
	wireConnections,
} from "./connections";
import { type Edits, wireEdits } from "./edits";
import { type ProfileStore, wireProfiles } from "./profiles";
import {
	HARNESS_BIN,
	type SettingsStore,
	type WiredSettings,
	wireSettings,
} from "./settings";

/** The stores of the configuration, as their readers hold them. */
export type ConfigStores = {
	settings: SettingsStore;
	connections: ConnectionStore;
	cliTools: CliToolStore;
	profiles: ProfileStore;
};

/**
 * What a person asks of this computer's configuration: each a use case
 * that takes who asks. The doors check the owner of this computer, or the
 * person's role in the Space, first.
 */
export type DeviceConfigUseCases = Edits &
	SecretEdits &
	Pick<WiredSettings, "viewSettings" | "saveSettings"> & {
		saveCliTool: ReturnType<typeof wireCliTools>["saveCliTool"];
		removeProfile: ReturnType<typeof wireProfiles>["removeProfile"];
		expandConnectionForTest: ReturnType<
			typeof wireConnections
		>["expandConnectionForTest"];
	};

/** This computer's configuration: the four stores, and the use cases of the doors. */
export type DeviceConfig = ConfigStores & {
	deviceConfig: DeviceConfigUseCases;
};

/**
 * This computer's configuration over its Device document: the settings,
 * the connections and secrets, the CLI tools and the profiles, each a
 * sub-vertical, and the edits that touch more than one of them. The
 * stores are not loaded yet: call `load` of each before the first read.
 */
export function wireDeviceConfig(deps: {
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
	/** Where a program is on this computer, or null. Default: a search of the PATH. */
	programs?: (program: string) => string | null;
}): DeviceConfig {
	const { document, env, secrets, personal, projects } = deps;
	const where = deps.programs ?? ((program: string) => findProgram(program));
	const { viewSettings, saveSettings, ...settings } = wireSettings({
		document,
		env,
	});
	const { expandConnectionForTest, secretEdits, ...connections } =
		wireConnections({
			document,
			env,
			secrets,
			// The Secret scope rule reads "Be a Host" from the settings (ADR 18).
			host: () => settings.current().host,
			...(personal ? { personal } : {}),
			...(projects ? { projects } : {}),
		});
	const { saveCliTool, ...cliTools } = wireCliTools({ document });
	const { removeProfile, ...profiles } = wireProfiles({ document });
	const edits = wireEdits({
		settings: {
			current: () => settings.current(),
			save: (patch) => settings.save(patch),
			bin: (harness) => String(settings.current()[HARNESS_BIN[harness]]),
		},
		profiles,
		connections,
		cliTools,
		programs: { where },
		labels: HARNESS_LABELS,
	});
	return {
		settings,
		connections,
		cliTools,
		profiles,
		deviceConfig: {
			...edits,
			...secretEdits,
			viewSettings,
			saveSettings,
			saveCliTool,
			removeProfile,
			expandConnectionForTest,
		},
	};
}
