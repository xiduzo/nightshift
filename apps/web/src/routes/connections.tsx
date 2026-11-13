import { createFileRoute, redirect } from "@tanstack/react-router";

/** The Connections page became the Tools page of Settings and the Secrets page. */
export const Route = createFileRoute("/connections")({
	beforeLoad: () => {
		throw redirect({
			to: "/settings",
			search: { section: "tools" },
			replace: true,
		});
	},
});
