import type { SettingsView } from "@/shared/api";
import type { SettingsPatch } from "./hooks/use-settings-form";

/**
 * `usage` and `usageSeen` on the settings view. Missing means the default:
 * sending is on, and the first-start notice has not been closed.
 */
export function readUsage(data: SettingsView): {
	on: boolean;
	seen: boolean;
	locked: string | undefined;
} {
	const values = data.values as SettingsView["values"] & {
		usage?: boolean;
		usageSeen?: boolean;
	};
	const fields = data.fields as SettingsView["fields"] & {
		usage?: { locked?: string };
	};
	return {
		on: values.usage !== false,
		seen: values.usageSeen === true,
		locked: fields.usage?.locked,
	};
}

/** Saves `usage` and `usageSeen`. The settings patch accepts them when they land. */
export function usagePatch(values: {
	usage: boolean;
	usageSeen?: boolean;
}): SettingsPatch {
	return values as SettingsPatch;
}
