import { createFileRoute } from "@tanstack/react-router";

import { PAGE_RANGES } from "@/features/dashboard";
import { preloadSpendPage, SpendPage } from "@/features/spend";

export const Route = createFileRoute("/spend")({
	// The page's range, so a link or a reload keeps it: `?range=90`.
	validateSearch: (
		search: Record<string, unknown>,
	): { range?: (typeof PAGE_RANGES)[number] } => ({
		range: PAGE_RANGES.find((days) => String(days) === String(search.range)),
	}),
	loader: ({ context }) => preloadSpendPage(context.queryClient),
	component: SpendRoute,
});

function SpendRoute() {
	const { range = 30 } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<SpendPage
			range={range}
			onRangeChange={(next) =>
				void navigate({ search: { range: next }, replace: true })
			}
		/>
	);
}
