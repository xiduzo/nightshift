import { type DeviceDocument, mapView } from "../../../../documents";
import type { SavedCliTools } from "../../application/ports";
import { readCliTools } from "../../domain/cli-tool";

/**
 * The CLI tools in this computer's Device document (its `cliTools` map).
 * A read parses the map again only after it changed. A write is one
 * change of the document.
 */
export function yjsSavedCliTools(
	document: Pick<DeviceDocument, "cliTools" | "revision" | "change">,
): SavedCliTools {
	const read = mapView(document, document.cliTools, () =>
		readCliTools(document.cliTools.entries()),
	);
	return {
		read,
		write: (name, entry) =>
			document.change(() => {
				document.cliTools.set(name, entry);
			}),
		remove: (name) =>
			document.change(() => {
				document.cliTools.delete(name);
			}),
	};
}
