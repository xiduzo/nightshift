import { type DeviceDocument, mapView } from "../../../../documents";
import type { SavedProfiles } from "../../application/ports";
import { readProfiles } from "../../domain/profile-entries";

/**
 * The profiles in this computer's Device document (its `profiles` map). A
 * read parses the map again only after it changed. A write is one change
 * of the document.
 */
export function yjsSavedProfiles(
	document: Pick<DeviceDocument, "profiles" | "revision" | "change">,
): SavedProfiles {
	const read = mapView(document, document.profiles, () =>
		readProfiles(document.profiles.entries()),
	);
	return {
		read,
		write: (id, entry) =>
			document.change(() => {
				document.profiles.set(id, entry);
			}),
		remove: (id) =>
			document.change(() => {
				document.profiles.delete(id);
			}),
	};
}
