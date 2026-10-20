import { createFileRoute } from "@tanstack/react-router";

import { DevicesPage } from "@/features/devices";

export const Route = createFileRoute("/devices")({
	// Polls from the browser; nothing to render on the server.
	ssr: false,
	/** `pair`: a code from the link a device printed; opens "Pair a device" with it. */
	validateSearch: (search: Record<string, unknown>): { pair?: string } =>
		typeof search.pair === "string" ? { pair: search.pair } : {},
	component: DevicesRoute,
});

function DevicesRoute() {
	const { pair } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<DevicesPage
			pair={pair}
			onPairClosed={() => void navigate({ search: {}, replace: true })}
		/>
	);
}
