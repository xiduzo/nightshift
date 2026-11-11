import { createFileRoute, redirect } from "@tanstack/react-router";

/** Schedules live with their flow now: an old link opens the Flows page. */
export const Route = createFileRoute("/projects/$projectId/schedules")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/projects/$projectId/flows",
			params: { projectId: params.projectId },
			replace: true,
		});
	},
});
