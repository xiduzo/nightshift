import { inMemorySpacePolicies } from "./in-memory-space-policies";

/**
 * `inMemorySpacesPorts`, which gives a use-case test every port of the
 * slice at once. Test code: production code never imports this file.
 */

/** Every port of spaces in memory at once: where each use-case test starts. */
export function inMemorySpacesPorts() {
	return {
		spacePolicies: inMemorySpacePolicies(),
	};
}
