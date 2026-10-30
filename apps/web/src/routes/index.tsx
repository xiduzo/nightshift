import { createFileRoute } from "@tanstack/react-router";

import {
	HomePrototype,
	PAGE_RANGES,
	preloadHomePage,
} from "@/features/dashboard";

export const Route = createFileRoute("/")({
	// PROTOTYPE: `?variant=` picks a Home variant; `?range=` the page's range.
	validateSearch: (
		search: Record<string, unknown>,
	): { range?: (typeof PAGE_RANGES)[number]; variant?: string } => ({
		range: PAGE_RANGES.find(
			(nights) => String(nights) === String(search.range),
		),
		variant: typeof search.variant === "string" ? search.variant : undefined,
	}),
	loader: ({ context }) => preloadHomePage(context.queryClient),
	component: HomeRoute,
});

function HomeRoute() {
	const { range = 7, variant } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<HomePrototype
			variant={variant}
			range={range}
			onRangeChange={(next) =>
				void navigate({
					search: (prev) => ({ ...prev, range: next }),
					replace: true,
				})
			}
		/>
	);
}
