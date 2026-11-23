import { type DeviceDocument, mapView } from "../../../../documents";
import type { SavedSettings } from "../../application/ports";
import { savedValues } from "../../domain/setting-fields";

/**
 * The saved settings in this computer's Device document (its `settings`
 * map). A read parses the map again only after it changed. A write is
 * one change of the document.
 */
export function yjsSavedSettings(
	document: Pick<DeviceDocument, "settings" | "revision" | "change">,
): SavedSettings {
	const read = mapView(document, document.settings, () =>
		savedValues(document.settings.entries()),
	);
	return {
		read,
		write: (plan) =>
			document.change(() => {
				for (const key of plan.forget) document.settings.delete(key);
				for (const [key, value] of plan.set) document.settings.set(key, value);
			}),
		onChange(listener) {
			const observer = () => listener();
			document.settings.observe(observer);
			return () => document.settings.unobserve(observer);
		},
	};
}
