import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Connections page became the Agents page (profiles, harnesses, tools) and the Secrets page. */
export const Route = createFileRoute("/connections")({
	beforeLoad: () => {
		throw redirect({ to: "/agents", replace: true });
	},
});
