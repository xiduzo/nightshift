import { createFileRoute } from "@tanstack/react-router";

import { ThisComputerSettings } from "@/features/devices";
import { AgentMenus } from "@/features/flows";
import { type ProtoSearch, PrototypeSettings } from "@/features/settings";

export const Route = createFileRoute("/settings")({
	// The theme and the notification permission exist only in the browser.
	ssr: false,
	/** PROTOTYPE, throw away: `section`, `agent`, `item`. */
	validateSearch: (search: Record<string, unknown>): ProtoSearch => {
		const out: ProtoSearch = {};
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
		<PrototypeSettings
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
			thisComputer={<ThisComputerSettings />}
			// The chat's agent picker: the route hands it over, as settings sits below flows.
			agentPicker={(props) => <AgentMenus {...props} />}
		/>
	);
}
