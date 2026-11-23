import { type DeviceDocument, mapView } from "../../../../documents";
import type { SavedConnections } from "../../application/ports";
import { readConnections } from "../../domain/saved-connection";

/**
 * The connections in this computer's Device document (its `connections`
 * map). A read parses the map again only after it changed. A write is one
 * change of the document.
 */
export function yjsSavedConnections(
	document: Pick<DeviceDocument, "connections" | "revision" | "change">,
): SavedConnections {
	const read = mapView(document, document.connections, () =>
		readConnections(document.connections.entries()),
	);
	return {
		read,
		write: (name, entry) =>
			document.change(() => {
				document.connections.set(name, entry);
			}),
		remove: (name) =>
			document.change(() => {
				document.connections.delete(name);
			}),
	};
}
