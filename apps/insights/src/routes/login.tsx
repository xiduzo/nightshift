import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { LoginPage } from "@/features/access";
import { authClient } from "@/shared/api";

const search = z.object({
	error: z.string().optional(),
});

export const Route = createFileRoute("/login")({
	validateSearch: search,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (session.data) throw redirect({ to: "/" });
	},
	component: Login,
});

function Login() {
	const { error } = Route.useSearch();
	return <LoginPage githubFailed={error !== undefined} />;
}
