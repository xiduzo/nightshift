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
 * The facts this computer reports in its document (where each harness CLI
 * and each program is): written at start and every ten minutes after, in
 * the background (listing the programs reads every PATH directory). The
 * timer of the daemon before a `bun --hot` reload stops first.
 */
export function reportDeviceFacts(deps: {
	db: Database;
	document: DeviceDocument;
	deviceId: string;
	settings: Pick<SettingsStore, "current">;
	kept: { nightshiftFacts?: Timer };
}): void {
	const { db, document, deviceId, settings } = deps;
	const refresh = () => {
		refreshDeviceFacts({
			db,
			document,
			deviceId,
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
	if (deps.kept.nightshiftFacts) clearInterval(deps.kept.nightshiftFacts);
	refresh();
	deps.kept.nightshiftFacts = setInterval(refresh, FACTS_EVERY_MS);
	deps.kept.nightshiftFacts.unref();
}
