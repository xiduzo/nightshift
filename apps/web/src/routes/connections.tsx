import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Connections page became the Agents page: profiles, harnesses, tools and secrets. */
export const Route = createFileRoute("/connections")({
	beforeLoad: () => {
		throw redirect({ to: "/agents", replace: true });
	},
});
