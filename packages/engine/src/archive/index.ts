/**
 * The Space archive: what a Replica keeps of each Space for the other
 * Replicas, run walk files and knowledge content by hash, here and at the
 * Space's Host.
 */

export {
	type ArchiveHost,
	type ArchiveRef,
	createSpaceArchive,
	type SpaceArchive,
	sha256Of,
	sha256OfFile,
	type WalkFile,
	type WalkRef,
} from "./space-archive";
export { writeWhole } from "./write-whole";
