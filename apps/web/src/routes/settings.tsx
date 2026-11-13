import { createFileRoute } from "@tanstack/react-router";

import { ThisComputerSettings } from "@/features/devices";
import { type ProtoSearch, PrototypeSettings } from "@/features/settings";

export const Route = createFileRoute("/settings")({
	// The theme and the notification permission exist only in the browser.
	ssr: false,
	/** PROTOTYPE, throw away: `variant`, `data`, `section`, `agent`. */
	validateSearch: (search: Record<string, unknown>): ProtoSearch => {
		const out: ProtoSearch = {};
		for (const key of ["variant", "data", "section", "agent"] as const) {
			const value = search[key];
			if (typeof value === "string" && value) out[key] = value;
		}
		return out;
	},
	component: SettingsRoute,
});

function SettingsRoute() {
	const search = Route.useSearch();
	return (
		<PrototypeSettings
			search={search}
			thisComputer={<ThisComputerSettings />}
		/>
	);
}
