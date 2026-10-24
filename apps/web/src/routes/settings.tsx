import { createFileRoute } from "@tanstack/react-router";

import { ThisComputerSettings } from "@/features/devices";
import { SettingsPage } from "@/features/settings";

export const Route = createFileRoute("/settings")({
	// The theme and the notification permission exist only in the browser.
	ssr: false,
	component: SettingsRoute,
});

function SettingsRoute() {
	return <SettingsPage thisComputer={<ThisComputerSettings />} />;
}
