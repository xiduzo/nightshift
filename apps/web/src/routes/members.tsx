import { createFileRoute } from "@tanstack/react-router";

import { MembersPage } from "@/features/spaces";

export const Route = createFileRoute("/members")({
	ssr: false,
	component: MembersPage,
});
