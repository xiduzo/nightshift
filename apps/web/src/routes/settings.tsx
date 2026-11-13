import { createFileRoute } from "@tanstack/react-router";

import { ThisComputerSettings } from "@/features/devices";
import { AgentMenus } from "@/features/flows";
import { SettingsPage, type SettingsSearch } from "@/features/settings";

export const Route = createFileRoute("/settings")({
	// The theme and the notification permission exist only in the browser.
	ssr: false,
	/** `section`: the page. `agent`: one of Night Shift's agents. `item`: what a list of your agents shows in detail. */
	validateSearch: (search: Record<string, unknown>): SettingsSearch => {
		const out: SettingsSearch = {};
		for (const key of ["section", "agent", "item"] as const) {
			const value = search[key];
			if (typeof value === "string" && value) out[key] = value;
		}
		return out;
	},
	component: SettingsRoute,
});

function SettingsRoute() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<SettingsPage
			search={search}
			onSelect={(item) =>
				void navigate({
					search: {
						...(search.section ? { section: search.section } : {}),
						...(item ? { item } : {}),
					},
					replace: true,
				})
			}
			thisComputer={<ThisComputerSettings titled={false} />}
			// The chat's agent picker. The route hands it over: the flow editor reads the settings, so settings does not import flows.
			agentPicker={(props) => <AgentMenus {...props} />}
		/>
	);
}
