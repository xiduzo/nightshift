import { createFileRoute } from "@tanstack/react-router";

import { HomePage, PAGE_RANGES, preloadHomePage } from "@/features/dashboard";

export const Route = createFileRoute("/")({
	// The page's range, so a link or a reload keeps it: `?range=30`.
	validateSearch: (
		search: Record<string, unknown>,
	): { range?: (typeof PAGE_RANGES)[number] } => ({
		range: PAGE_RANGES.find(
			(nights) => String(nights) === String(search.range),
		),
	}),
	loader: ({ context }) => preloadHomePage(context.queryClient),
	component: HomeRoute,
});

function HomeRoute() {
	const { range = 7 } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<HomePage
			range={range}
			onRangeChange={(next) =>
				void navigate({ search: { range: next }, replace: true })
			}
		/>
	);
}
