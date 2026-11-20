import {
	type SpaceDocuments,
	setSpaceUsage,
	spaceUsageOn,
} from "../../../documents";
import type { SpacePolicies } from "../../application/ports";

/**
 * `SpacePolicies` over the Space documents: the policy is the `policy` map
 * of each Space's document. `wireSpaces` builds it.
 */
export function yjsSpacePolicies(
	documents: Pick<SpaceDocuments, "open" | "openAll">,
): SpacePolicies {
	return {
		async setUsage(spaceId, enabled) {
			const document = await documents.open(spaceId);
			if (document.hostedElsewhere) return false;
			await setSpaceUsage(document, enabled);
			return true;
		},
		async usageOn() {
			const spaces = await documents.openAll();
			return spaces.map(spaceUsageOn);
		},
	};
}
