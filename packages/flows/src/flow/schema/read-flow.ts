import { FLOW_VERSION, type Flow, flowSchema } from "./flow";

/** What a person reads about a flow that an older Night Shift made. */
export const OLDER_FLOW = "An older version of Night Shift made this flow.";

/** What a person reads about a flow that a newer Night Shift made. */
export const NEWER_FLOW =
	"A newer version of Night Shift made this flow. Update Night Shift to use it.";

/** One reason why JSON does not read as a flow. `path` is empty for the whole flow. */
export type ReadFlowIssue = { path: string; message: string };

/**
 * What `readFlow` makes of JSON: the flow, or why there is none.
 * - `older`: its format is older than this Night Shift's. Only the current
 *   format is read (ADR 43).
 * - `newer`: a newer Night Shift made it.
 * - `invalid`: it is no flow, or not a whole one.
 */
export type ReadFlow =
	| { flow: Flow }
	| {
			flow: null;
			why: "older" | "newer" | "invalid";
			issues: readonly ReadFlowIssue[];
	  };

/**
 * Reads unknown JSON as a flow of the current format: the one door for a
 * stored flow, a copy in a run or a revision, and a file. It looks at the
 * version first, so an older flow that fits the schema by chance is not
 * read as one. It never throws and changes nothing.
 */
export function readFlow(json: unknown): ReadFlow {
	const version =
		typeof json === "object" && json !== null && "version" in json
			? json.version
			: undefined;
	if (typeof version === "number" && version < FLOW_VERSION) {
		return unread("older", [{ path: "", message: OLDER_FLOW }]);
	}
	if (typeof version === "number" && version > FLOW_VERSION) {
		return unread("newer", [{ path: "", message: NEWER_FLOW }]);
	}
	const parsed = flowSchema.safeParse(json);
	if (parsed.success) return { flow: parsed.data };
	return unread(
		"invalid",
		parsed.error.issues.map((issue) => ({
			path: issue.path.map(String).join("."),
			message: issue.message,
		})),
	);
}

function unread(
	why: "older" | "newer" | "invalid",
	issues: readonly ReadFlowIssue[],
): ReadFlow {
	return { flow: null, why, issues };
}
