import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { FieldDescription } from "@nightshift/ui/components/field";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { AccountForm } from "./account-form";

/**
 * Signing in from another computer. New people join by invitation only:
 * the invitation link makes their account (`/invite/$invitationId`).
 * After it, back to the page that sent you here (`redirect`), else home.
 */
export function LoginPage({
	redirect,
}: {
	/** The page to go back to after signing in, from the route's search. */
	redirect: string | undefined;
}) {
	const navigate = useNavigate();
	const router = useRouter();
	const queryClient = useQueryClient();
	return (
		<div className="flex min-h-svh items-center justify-center p-4 md:p-6">
			<Card className="w-full max-w-sm">
				<CardHeader>
					<CardTitle>Sign in to Night Shift</CardTitle>
					<CardDescription>
						Enter the email and password of your account.
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
