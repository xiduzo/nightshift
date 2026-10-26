/**
 * Sections: named frames around nodes of one flow, for the editor only.
 * Whether nodes can form a Section, and the edges that cross its frame.
 * The edits that add, change and remove Sections are in `draft/`.
 */

export {
	canMakeSection,
	type SectionBoundary,
	type SectionCheck,
	type SectionCheckOptions,
	type SectionExit,
	type SectionProblem,
	sectionBoundary,
	sectionOf,
} from "./shape";
export {
	nodesWithin,
	parentSection,
	sectionLevel,
	sectionPath,
	sectionsWithin,
} from "./tree";
