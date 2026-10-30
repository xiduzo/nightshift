import type { Engine } from "@nightshift/engine";

import type { DigestSource } from "./digest";

/**
 * How many of a Space's newest runs a digest reads. A run that started
 * before them and ended since the last digest is left out.
 */
const RUNS_READ = 300;

/** The engine's runs and open Gates, as the digest reads them. */
export function engineDigestSource(
	engine: Pick<Engine, "space">,
): DigestSource {
	return {
		async endedRuns(spaceId, since) {
			const runs = await engine.space(spaceId).listRuns({ limit: RUNS_READ });
			return runs.flatMap((run) =>
				run.endedAt !== null && run.endedAt > since
					? [{ ...run, spaceId, endedAt: run.endedAt }]
					: [],
			);
		},
		async waitingGates(spaceId) {
			return engine.space(spaceId).listGates();
		},
	};
}
