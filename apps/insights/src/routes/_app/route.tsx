import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { SecondFactor } from "@/features/access";
import { authClient } from "@/shared/api";
import { AppShell } from "@/shared/shell";

export const Route = createFileRoute("/_app")({
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) throw redirect({ to: "/login" });
	},
	component: App,
});

function App() {
	return (
		<AppShell extra={<SecondFactor />}>
			<Outlet />
		</AppShell>
	);
}
