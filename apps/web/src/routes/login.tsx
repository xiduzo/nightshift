import { createFileRoute } from "@tanstack/react-router";

import { LoginPage, safeRedirect } from "@/features/access";

export const Route = createFileRoute("/login")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
		redirect: safeRedirect(search.redirect),
	}),
	component: LoginRoute,
});

function LoginRoute() {
	const { redirect } = Route.useSearch();
	return <LoginPage redirect={redirect} />;
}
