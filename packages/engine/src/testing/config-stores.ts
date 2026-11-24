import type { Access, ComputerAccess } from "../access";
import { type DeviceConfig, wireSettings } from "../settings";
import { wireCliTools } from "../settings/cli-tools";
import { wireConnections } from "../settings/connections";
import { wireProfiles } from "../settings/profiles";
import { wireSettings as wireSettingsStore } from "../settings/settings";

/** A computer that every Person owns: for a test that is not about who may act on it. */
const ANYONES: ComputerAccess = { openComputer: () => {} };

/** Spaces where every Person may do all. */
const OPEN_SPACES: Pick<Access, "openSpace"> = { openSpace: async () => {} };

/** What a wire of the configuration takes, without who may act: anyone, unless the test says so. */
type WithoutAccess<T> = Omit<T, "computerAccess" | "access"> &
	Partial<Pick<T, Extract<keyof T, "computerAccess" | "access">>>;

/** This computer's configuration over a test's Device document, loaded as the daemon loads it. */
export async function openConfigStores(
	options: WithoutAccess<Parameters<typeof wireSettings>[0]>,
): Promise<DeviceConfig> {
	const config = wireSettings({
		computerAccess: ANYONES,
		access: OPEN_SPACES,
		...options,
	});
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

export const createConnectionStore = (
	options: WithoutAccess<Parameters<typeof wireConnections>[0]>,
) =>
	wireConnections({
		computerAccess: ANYONES,
		access: OPEN_SPACES,
		...options,
	});
