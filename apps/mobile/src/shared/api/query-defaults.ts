import type { QueryClient } from "@tanstack/react-query";

import { KEPT_MAX_AGE_MS, KEPT_PATHS } from "./kept-queries";

const MINUTE_MS = 60 * 1000;

/**
 * How long each kind of read stays fresh on the phone. Other reads keep
 * the shared minute (`createQueryClient` of `@nightshift/client`).
 *
 * - Gates and runs: until the live cache marks them stale. It follows the
 *   Host, and after a drop of the stream it reads them all again.
 * - The dashboard (Home and the Console of a project): totals change slowly.
 * - Projects, flows, Spaces and schedules: they change on the desktop, seldom.
 */
const PHONE_STALE_MS: Readonly<Record<string, number>> = {
	"gates.list": Number.POSITIVE_INFINITY,
	"runs.list": Number.POSITIVE_INFINITY,
	"runs.get": Number.POSITIVE_INFINITY,
	"runs.step": Number.POSITIVE_INFINITY,
	"runs.artifacts": Number.POSITIVE_INFINITY,
	dashboard: 5 * MINUTE_MS,
	"projects.list": 10 * MINUTE_MS,
	"flows.list": 10 * MINUTE_MS,
	"spaces.list": 10 * MINUTE_MS,
	"schedules.list": 10 * MINUTE_MS,
};

/** The query key prefix of an oRPC path: `"runs.get"` → `[["runs", "get"]]`. */
function keyOf(path: string): [string[]] {
	return [path.split(".")];
}

/**
 * Sets the phone's defaults per kind of read: how long it stays fresh, and
 * for a kept read, how long it stays in the cache. A kept read stays as
 * long as the phone keeps it (`KEPT_MAX_AGE_MS`). Else a tab that is not
 * in front would drop it, and the next write would forget it too.
 */
export function setPhoneQueryDefaults(queryClient: QueryClient): void {
	const paths = new Set([...Object.keys(PHONE_STALE_MS), ...KEPT_PATHS]);
	for (const path of paths) {
		const staleTime = PHONE_STALE_MS[path];
		const kept = (KEPT_PATHS as readonly string[]).includes(path);
		queryClient.setQueryDefaults(keyOf(path), {
			...(staleTime !== undefined ? { staleTime } : {}),
			...(kept ? { gcTime: KEPT_MAX_AGE_MS } : {}),
		});
	}
}
