import type { RunTrace } from "../../../read";
import type { RunViews } from "./ports";

export type ReadRunTracePorts = { views: Pick<RunViews, "trace"> };

/**
 * A run as an export to monitoring reads it, in any Space of this
 * Replica, for Night Shift itself. Null for a run this Replica has no
 * events of.
 */
export const readRunTrace =
	(ports: ReadRunTracePorts) =>
	(request: { runId: string }): Promise<RunTrace | null> =>
		ports.views.trace(request.runId);
