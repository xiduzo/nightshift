import type { ComputerAccess } from "../access";
import { type DeviceConfig, wireSettings } from "../settings";
import { wireCliTools } from "../settings/cli-tools";
import { wireConnections } from "../settings/connections";
import { wireProfiles } from "../settings/profiles";
import { wireSettings as wireSettingsStore } from "../settings/settings";

/** A computer that every Person owns: for a test that is not about who may act on it. */
const ANYONES: ComputerAccess = { openComputer: () => {} };

/** What a wire of the configuration takes, without who may act: `ANYONES` unless the test says so. */
type WithoutAccess<T extends { computerAccess: unknown }> = Omit<
	T,
	"computerAccess"
> &
	Partial<Pick<T, "computerAccess">>;

/** This computer's configuration over a test's Device document, loaded as the daemon loads it. */
export async function openConfigStores(
	options: WithoutAccess<Parameters<typeof wireSettings>[0]>,
): Promise<DeviceConfig> {
	const config = wireSettings({ computerAccess: ANYONES, ...options });
	const { settings, connections, cliTools, profiles } = config;
	await Promise.all(
		[settings, connections, cliTools, profiles].map((store) => store.load()),
	);
	return config;
}

export const createSettingsStore = (
	deps: WithoutAccess<Parameters<typeof wireSettingsStore>[0]>,
) => wireSettingsStore({ computerAccess: ANYONES, ...deps });

export const createProfileStore = (
	deps: WithoutAccess<Parameters<typeof wireProfiles>[0]>,
) => wireProfiles({ computerAccess: ANYONES, ...deps });

export const createCliToolStore = (
	deps: WithoutAccess<Parameters<typeof wireCliTools>[0]>,
) => wireCliTools({ computerAccess: ANYONES, ...deps });

export const createConnectionStore = wireConnections;
