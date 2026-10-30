import { createFileRoute } from "@tanstack/react-router";

import { DevicesPage } from "@/features/devices";

export const Route = createFileRoute("/devices")({
	// Polls from the browser; nothing to render on the server.
	ssr: false,
	/**
	 * `device`: the device whose detail is open: "host", "phone:<id>" or a computer's id.
	 * `pair`: a code from the link a device printed; opens "Pair a device" with it.
	 */
	validateSearch: (
		search: Record<string, unknown>,
	): { device?: string; pair?: string } => ({
		...(typeof search.device === "string" ? { device: search.device } : {}),
		...(typeof search.pair === "string" ? { pair: search.pair } : {}),
	}),
	component: DevicesRoute,
});

function DevicesRoute() {
	const { device, pair } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<DevicesPage
			selected={device}
			onSelect={(next) =>
				void navigate({ search: (prev) => ({ ...prev, device: next }) })
			}
			pair={pair}
			onPairClosed={() =>
				void navigate({
					search: (prev) => ({ device: prev.device }),
					replace: true,
				})
			}
		/>
	);
}
