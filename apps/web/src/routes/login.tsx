import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { FieldDescription } from "@nightshift/ui/components/field";
import { useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";

import { AccountForm } from "@/components/members/account-form";
import { safeRedirect } from "@/lib/access";

export const Route = createFileRoute("/login")({
	ssr: false,
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
		redirect: safeRedirect(search.redirect),
	}),
	component: LoginRoute,
});

/**
 * Signing in from another computer. New people join by invitation only:
 * the invitation link makes their account (`/invite/$invitationId`).
 * After it, back to the page that sent you here (`redirect`), else home.
 */
function LoginRoute() {
	const { redirect } = Route.useSearch();
	const navigate = useNavigate();
	const router = useRouter();
	const queryClient = useQueryClient();
	return (
		<div className="flex min-h-svh items-center justify-center p-4 md:p-6">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>Sign in to Night Shift</CardTitle>
					<CardDescription>
						Use the email and password of your account here.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<AccountForm
						mode="sign-in"
						submitLabel="Sign in"
						onDone={async () => {
							await queryClient.invalidateQueries();
							if (redirect) router.history.push(redirect);
							else await navigate({ to: "/" });
						}}
						footer={
							<FieldDescription className="text-center">
								New here? Open the invitation link a member of a Space sent you.
							</FieldDescription>
						}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
