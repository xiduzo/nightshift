import { createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "@/features/access";

export const Route = createFileRoute("/account")({
	ssr: false,
	component: AccountPage,
});
