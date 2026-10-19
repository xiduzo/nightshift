import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { FieldDescription } from "@nightshift/ui/components/field";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AccountForm } from "@/components/members/account-form";

export const Route = createFileRoute("/login")({
	ssr: false,
	component: LoginRoute,
});

/**
 * Signing in from another computer. New people join by invitation only:
 * the invitation link makes their account (`/invite/$invitationId`).
 */
function LoginRoute() {
	const navigate = useNavigate();
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
							await navigate({ to: "/" });
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
