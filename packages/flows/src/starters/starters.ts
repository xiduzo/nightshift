import buildTask from "./flows/build-task.json";
import editFile from "./flows/edit-file.json";
import implementAndCheck from "./flows/implement-and-check.json";
import perFile from "./flows/per-file.json";
import planAndBuild from "./flows/plan-and-build.json";
import reviewPr from "./flows/review-pr.json";

/**
 * Starters: small flows that ship with Night Shift, for a person to change.
 * Unlike a kit, a starter is copied into a project as the project's own
 * flow, when the project is added or from its file (`README.md`). The files
 * are format 6: an import brings them to the current format.
 */

/** One starter: the name it takes in a project, and its file's contents. */
export type Starter = { name: string; source: unknown };

/** The starters, in the order a person meets them. A flow comes after the flows it calls. */
const STARTERS: readonly Starter[] = [
	{ name: "implement-and-check", source: implementAndCheck },
	{ name: "build-task", source: buildTask },
	{ name: "plan-and-build", source: planAndBuild },
	{ name: "review-pr", source: reviewPr },
	{ name: "edit-file", source: editFile },
	{ name: "per-file", source: perFile },
];

/** Every starter. */
export function starterList(): readonly Starter[] {
	return STARTERS;
}
