import { createFileRoute } from "@tanstack/react-router";

import { InvitePage } from "@/features/spaces";

export const Route = createFileRoute("/invite/$invitationId")({
	// The session lives in the browser; nothing to render on the server.
	ssr: false,
	component: InviteRoute,
});

function InviteRoute() {
	const { invitationId } = Route.useParams();
	return <InvitePage invitationId={invitationId} />;
}
