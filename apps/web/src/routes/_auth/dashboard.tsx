import { createFileRoute } from "@tanstack/react-router";

// Kept for the sign-in flow, which is not used in local single-user mode.
export const Route = createFileRoute("/_auth/dashboard")({
	component: RouteComponent,
});

function RouteComponent() {
	const { session } = Route.useRouteContext();

	return (
		<div>
			<h1>Dashboard</h1>
			<p>Welcome {session.data?.user.name}</p>
		</div>
	);
}
