import { DECIDER_SETUP } from "@nightshift/agents";
import type { Context } from "@nightshift/api/context";
import { inContainer } from "@nightshift/devices";
import {
	createConfigUse,
	createToolLaunchers,
	openDeviceDocument,
	secretStore,
} from "@nightshift/engine";
import { type DeciderSetupDeps, wireAgents } from "@nightshift/engine/agents";
import { type DeviceConfig, wireSettings } from "@nightshift/engine/settings";
import type { Telemetry } from "@nightshift/telemetry";
import { programChecks } from "./agents";
import {
	type DaemonEnv,
	type HotRegistry,
	type HotSlots,
	secretFiles,
	secretsDir,
} from "./runtime";

type ConfigOptions = Parameters<typeof wireSettings>[0];
type ConfigUseDeps = Parameters<typeof createConfigUse>[0];

/**
 * This Device's document: its profiles, CLI tools, connections, settings
 * and facts. The stores of the config block are views of it; the relay
 * (`/sync`) serves it to this computer's clients, and their edits land in
 * the same stores.
 */
export function openDeviceConfig(
	options: Parameters<typeof openDeviceDocument>[0],
) {
	return openDeviceDocument(options);
}

/**
 * The config block of the daemon's composition (`daemon.ts`): this
 * computer's settings, connections, CLI tools and profiles, and the
 * launchers of the CLI tools. The lanes of `device-config` and
 * `agent-setup` edit this file, not `daemon.ts`.
 */
/** Who may ask of this computer: its owner (`wireComputer`). */
type OfThisComputer = Pick<ConfigOptions, "computerAccess">;

export async function wireDaemonConfig(
	deps: OfThisComputer & {
		/** Who may act in a Space (`wireDaemonAccess`). */
		access: ConfigOptions["access"];
		env: DaemonEnv;
		dataDir: string;
		document: ConfigOptions["document"];
		/**
		 * The Person's Personal secrets (ADR 13): at the Home Host, else kept
		 * here. The devices give them; a use before that reads a Personal name
		 * as one that cannot be read now.
		 */
		personal: ConfigOptions["personal"];
		/** The secrets of the Projects (ADR 13): at the Host of their Space, else kept here. The devices give them too. */
		projects: ConfigOptions["projects"];
	},
) {
	const { env, dataDir } = deps;
	/**
	 * The environment is the fallback of every setting and every `${NAME}`.
	 * Under it, the secret files a service manager gives a headless computer
	 * (NIGHTSHIFT_SECRETS_DIR, else systemd's credentials).
	 */
	const fallbacks: Record<string, string | undefined> = {
		...secretFiles(secretsDir()),
		...process.env,
		...env,
	};
	/** Secrets saved on the Connections page: the keychain, else a file per secret (headless). */
	const keyStore =
		env.NIGHTSHIFT_KEY_STORE === "file" ? { prefer: "file" as const } : {};

	const config = wireSettings({
		computerAccess: deps.computerAccess,
		access: deps.access,
		document: deps.document,
		env: fallbacks,
		secrets: await secretStore({ dataDir, ...keyStore }),
		personal: deps.personal,
		projects: deps.projects,
	});
	const { settings, connections, cliTools, profiles } = config;
	await Promise.all(
		[settings, connections, cliTools, profiles].map((store) => store.load()),
	);
	// Each CLI tool with a login runs through a launcher of its step. A
	// login's own folder is in the data folder, so it outlives a restart.
	const toolLaunchers = createToolLaunchers({
		tools: cliTools,
		secretEnv: (names, use) => connections.secretEnv(names, use),
		dataDir,
		env: { ...process.env, ...env },
	});
	return { config, keyStore, toolLaunchers };
}

/**
 * The setups of the config block: the checks of programs, the guided
 * setups of an agent CLI and of a decider, and the configuration the
 * flows of a Space use.
 */
export async function wireSetups(
	deps: OfThisComputer & {
		slots: Pick<HotSlots<HotRegistry>, "replace">;
		config: DeviceConfig;
		toolLaunchers: ConfigUseDeps["toolLaunchers"];
		deviceId: string;
		/** The Space view for the session's Person. */
		space: ConfigUseDeps["space"];
		ollama: DeciderSetupDeps["ollama"];
		usage: Pick<Telemetry, "note">;
	},
) {
	const { slots, config } = deps;
	/** The read-only checks of programs. A harness's check notes `agent-checked`. */
	const checks: Context["checks"] = {
		...programChecks(),
		harness: async (harness, bin) => {
			const check = await programChecks().harness(harness, bin);
			deps.usage.note({
				kind: "agent-checked",
				harness,
				installed: check.path !== null,
				signIn: check.signIn,
			});
			return check;
		},
	};
	/**
	 * Installs an agent CLI and signs it in, when the person asks for it on
	 * this computer (ADR 25). A reload stops what it runs.
	 */
	const agentSetup = await slots.replace(
		"nightshiftAgentSetup",
		() =>
			wireAgents({
				computerAccess: deps.computerAccess,
				stores: config,
				check: (harness, bin) => checks.harness(harness, bin),
				container: inContainer(),
			}).agent,
		(before) => before.stop(),
	);
	/**
	 * Sets up a decider, when the person asks for it on this computer (Q22):
	 * Ollama with its small model, or a TypeSafe key. A reload stops what
	 * it runs.
	 */
	const deciderSetup = await slots.replace(
		"nightshiftDeciderSetup",
		() =>
			wireAgents({
				computerAccess: deps.computerAccess,
				stores: config,
				check: async () => ({ signIn: "unknown", account: null }),
				ollama: deps.ollama,
				localModel: DECIDER_SETUP.localModel,
				typesafeKey: DECIDER_SETUP.typesafeKey,
				container: inContainer(),
			}).decider,
		(before) => before.stop(),
	);
	const { connections, cliTools, profiles } = config;
	const configUse = createConfigUse({
		deviceId: deps.deviceId,
		space: deps.space,
		connections,
		cliTools,
		profiles,
		toolLaunchers: deps.toolLaunchers,
	});
	return { checks, agentSetup, deciderSetup, configUse };
}
