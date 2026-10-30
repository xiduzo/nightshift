import { createFileRoute } from "@tanstack/react-router";

import { DevicesPage } from "@/features/devices";

export const Route = createFileRoute("/devices")({
	// Polls from the browser; nothing to render on the server.
	ssr: false,
	/**
	 * `device`: what is open, "host" or a computer's id.
	 * `pair`: a code from the link a device printed; opens "Pair a device" with it.
	 */
	validateSearch: (
		search: Record<string, unknown>,
	): { device?: string; pair?: string; variant?: string; state?: string } => ({
		...(typeof search.device === "string" ? { device: search.device } : {}),
		...(typeof search.pair === "string" ? { pair: search.pair } : {}),
		// PROTOTYPE, throw away: which shape of the page.
		...(typeof search.variant === "string" ? { variant: search.variant } : {}),
		...(typeof search.state === "string" ? { state: search.state } : {}),
	}),
	component: DevicesRoute,
});

function DevicesRoute() {
	const { device, pair, variant } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<DevicesPage
			selected={device}
			variant={variant}
			onSelect={(next) =>
				void navigate({ search: (prev) => ({ ...prev, device: next }) })
			}
			pair={pair}
			onPairClosed={() =>
				void navigate({
					search: (prev) => ({
						device: prev.device,
						variant: prev.variant,
						state: prev.state,
					}),
					replace: true,
				})
			}
		/>
	);
}
