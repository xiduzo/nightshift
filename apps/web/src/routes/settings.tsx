import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "@/features/settings";

export const Route = createFileRoute("/settings")({
	// The theme and the notification permission exist only in the browser.
	ssr: false,
	component: SettingsPage,
});
