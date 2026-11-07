import buildTask from "./flows/build-task.json";
import editFile from "./flows/edit-file.json";
import implementAndCheck from "./flows/implement-and-check.json";
import perFile from "./flows/per-file.json";
import planAndBuild from "./flows/plan-and-build.json";
import reviewLearnings from "./flows/review-learnings.json";

/**
 * Starters: small flows that ship with Night Shift, for a person to change.
 * Unlike a kit, a starter is copied into a project as the project's own
 * flow, when the project is added or from its file (`README.md`). The files
 * are format 6: an import brings them to the current format.
 *
 * Each one meets the starter standard of the README: it fits any project,
 * needs one agent login only, is self-contained, and starts on its own. A
 * flow that needs a vendor account or an MCP server goes to `community/` at
 * the root of the repository instead.
 */

/**
 * One starter: the name it takes in a project, and its file's contents.
 * `partOf` names the starter that calls a helper. A helper installs with its
 * parent, and no list a person sees shows it as a starter.
 */
export type Starter = { name: string; source: unknown; partOf?: string };

/** The starters, in the order a person meets them. A flow comes after the flows it calls. */
const STARTERS: readonly Starter[] = [
	{ name: "implement-and-check", source: implementAndCheck },
	{ name: "build-task", source: buildTask, partOf: "plan-and-build" },
	{ name: "plan-and-build", source: planAndBuild },
	{ name: "edit-file", source: editFile, partOf: "per-file" },
	{ name: "review-learnings", source: reviewLearnings },
	{ name: "per-file", source: perFile },
];

/** Every starter, helpers included: what adding a project installs. */
export function starterList(): readonly Starter[] {
	return STARTERS;
}
