import { join } from "node:path";
import type { Engine } from "@nightshift/engine";
import {
	type DeviceDocument,
	type KeyStoreKind,
	type SettingsStore,
	valueStore,
} from "@nightshift/engine/device-config";
import { createTelemetry, type Telemetry } from "@nightshift/telemetry";

/**
 * The export to monitoring of this computer ("Send runs to your
 * monitoring"), wired: the runs this engine walks, the settings of the
 * Device document, and the headers in a value store of their own (the
 * keychain, else `<dataDir>/telemetry`). A change of the settings, from the
 * Settings page or another of the owner's screens, applies at once: no
 * restart. New on each `bun --hot` reload; the one before stops first.
 */
export function wireTelemetry(deps: {
	engine: Pick<Engine, "onLandedFacts" | "runTrace">;
	deviceId: string;
	settings: SettingsStore;
	document: Pick<DeviceDocument, "settings">;
	dataDir: string;
	keyStore: { prefer?: KeyStoreKind };
}): Telemetry & { start(): Promise<void> } {
	let unobserve = () => {};
	const telemetry = createTelemetry({
		engine: deps.engine,
		deviceId: deps.deviceId,
		settings: () => {
			const s = deps.settings.current();
			return {
				enabled: s.telemetry,
				endpoint: s.telemetryEndpoint,
				protocol: s.telemetryProtocol,
			};
		},
		values: lazyValues({
			service: "nightshift-telemetry",
			dir: join(deps.dataDir, "telemetry"),
			...deps.keyStore,
		}),
	});
	return {
		...telemetry,
		async start() {
			const refresh = () => void telemetry.refresh();
			deps.document.settings.observe(refresh);
			unobserve = () => deps.document.settings.unobserve(refresh);
			await telemetry.refresh();
		},
		async stop() {
			unobserve();
			await telemetry.stop();
		},
	};
}

/** The value store, opened on first use: a probe of the keychain waits until the headers are needed. */
function lazyValues(options: Parameters<typeof valueStore>[0]) {
	let opened: ReturnType<typeof valueStore> | null = null;
	const store = () => {
		opened ??= valueStore(options);
		return opened;
	};
	return {
		get: async (name: string) => (await store()).get(name),
		set: async (name: string, value: string) =>
			(await store()).set(name, value),
		delete: async (name: string) => (await store()).delete(name),
	};
}
