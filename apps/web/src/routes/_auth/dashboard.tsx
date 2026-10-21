import { createFileRoute } from "@tanstack/react-router";

import { SignedInPage } from "@/features/access";

// Kept for the sign-in flow, which is not used in local single-user mode.
export const Route = createFileRoute("/_auth/dashboard")({
	component: RouteComponent,
});

function RouteComponent() {
	const { session } = Route.useRouteContext();
	return <SignedInPage name={session.data?.user.name} />;
}
