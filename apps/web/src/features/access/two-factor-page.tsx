import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { authClient } from "@/shared/api";
import { accountQueries } from "./queries";
import { TwoFactorSetup } from "./two-factor-setup";

/**
 * The Host requires two-factor sign-in, and you have not turned it on:
 * this page is all you can use until you do (or sign out).
 */
export function TwoFactorPage({
	redirect,
}: {
	/** The page to go back to after the setup, from the route's search. */
	redirect: string | undefined;
}) {
	const navigate = useNavigate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const status = useQuery(accountQueries.status());
	/**
	 * The setup started. It turns two-factor on before the backup codes
	 * show, so from now on only Done leaves the page.
	 */
	const started = useRef(false);
	if (status.data?.twoFactor.setUpNeeded) started.current = true;

	/** Back to the page that sent you here, else home. */
	const back = useCallback(async () => {
		if (redirect) router.history.push(redirect);
		else await navigate({ to: "/" });
	}, [redirect, router, navigate]);

	const leave = async () => {
		await queryClient.invalidateQueries();
		await back();
	};

	// Nothing to set up here: not signed in, or two-factor is on already.
	useEffect(() => {
		if (!status.data || started.current) return;
		if (!status.data.signedIn) {
			void navigate({ to: "/login", search: { redirect }, replace: true });
		} else if (!status.data.twoFactor.setUpNeeded) void back();
	}, [status.data, navigate, back, redirect]);

	return (
		<div className="flex min-h-svh items-center justify-center p-4 md:p-6">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Turn on two-factor sign-in</CardTitle>
					<CardDescription>
						This Host asks for a code from an authenticator app when you sign in
						from another computer. Turn it on once to continue.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{status.data?.person && started.current ? (
						<TwoFactorSetup
							email={status.data.person.email}
							submitLabel="Continue to Night Shift"
							onDone={leave}
						/>
					) : (
						<Skeleton className="h-40 w-full" />
					)}
				</CardContent>
				<CardFooter>
					<Button
						variant="link"
						className="px-0"
						onClick={() =>
							void authClient.signOut().then(async () => {
								queryClient.clear();
								await navigate({ to: "/login" });
							})
						}
					>
						Sign out
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}
