import { pathPrograms } from "@nightshift/agents";
import type { Database } from "@nightshift/db";
import {
	type DeviceDocument,
	HARNESS_BIN,
	refreshDeviceFacts,
	type SettingsStore,
} from "@nightshift/engine";

/** How often this computer reports its facts again. */
const FACTS_EVERY_MS = 10 * 60_000;

/**
 * The facts this computer reports in its document (its name, where each
 * harness CLI and each program is): written at start and every ten
 * minutes after, in the background (listing the programs reads every PATH
 * directory). Returns the timer: the daemon replaces it on a `bun --hot`
 * reload.
 */
export function reportDeviceFacts(deps: {
	db: Database;
	document: DeviceDocument;
	deviceId: string;
	/** This computer's Device name. */
	name: string;
	settings: Pick<SettingsStore, "current">;
}): Timer {
	const { db, document, deviceId, name, settings } = deps;
	const refresh = () => {
		refreshDeviceFacts({
			db,
			document,
			deviceId,
			name,
			harnesses: () => {
				const s = settings.current();
				return Object.fromEntries([
					...s.harnesses.map((name) => [name, Bun.which(s[HARNESS_BIN[name]])]),
					...s.customAgents.map((a) => [
						`acp:${a.slug}` as const,
						Bun.which(a.command),
					]),
				]);
			},
			programs: () => pathPrograms(),
		}).catch((error) => {
			console.error("This computer's facts were not updated:", error);
		});
	};
	refresh();
	const timer = setInterval(refresh, FACTS_EVERY_MS);
	timer.unref();
	return timer;
}
