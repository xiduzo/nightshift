import { createFileRoute } from "@tanstack/react-router";

import { safeRedirect, TwoFactorPage } from "@/features/access";

export const Route = createFileRoute("/two-factor")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: safeRedirect(search.redirect),
	}),
	component: TwoFactorRoute,
});

function TwoFactorRoute() {
	const { redirect } = Route.useSearch();
	return <TwoFactorPage redirect={redirect} />;
}
