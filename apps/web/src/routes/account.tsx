import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon, CircleUserRoundIcon } from "lucide-react";

import { TwoFactorSection } from "@/components/account/two-factor-section";
import { PageHeading, PageSection } from "@/components/page-heading";
import { SiteHeader } from "@/components/site-header";
import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/account")({
	ssr: false,
	component: AccountRoute,
});

/** You, and how you sign in: your email, two-factor sign-in, signing out. */
function AccountRoute() {
	const status = useQuery(orpc.account.status.queryOptions());
	const session = authClient.useSession();
	const user = session.data?.user;

	return (
		<>
			<SiteHeader crumbs={[{ label: "Account" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
					<PageHeading
						title="Account"
						description="Who you are in Night Shift, and how you sign in."
					/>
					{status.error ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>Your account did not load</AlertTitle>
							<AlertDescription>{status.error.message}</AlertDescription>
						</Alert>
					) : null}
					<PageSection title="You">
						<Card>
							<CardContent>
								{user && status.data ? (
									<You
										name={user.name}
										email={user.email}
										thisComputer={status.data.thisComputer}
									/>
								) : (
									<Skeleton className="h-12 w-full" />
								)}
							</CardContent>
						</Card>
					</PageSection>
					<PageSection
						title="Two-factor sign-in"
						description="A code from an app on your phone, after your password."
					>
						{user && status.data ? (
							<TwoFactorSection status={status.data} email={user.email} />
						) : (
							<Skeleton className="h-24 w-full rounded-xl" />
						)}
					</PageSection>
				</div>
			</div>
		</>
	);
}

function You({
	name,
	email,
	thisComputer,
}: {
	name: string;
	email: string;
	thisComputer: boolean;
}) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	return (
		<Item size="sm" className="px-0">
			<ItemMedia variant="icon">
				<CircleUserRoundIcon aria-hidden="true" />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle>{name}</ItemTitle>
				<ItemDescription>{email}</ItemDescription>
			</ItemContent>
			{thisComputer ? null : (
				<ItemActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() =>
							void authClient.signOut().then(async () => {
								queryClient.clear();
								await navigate({ to: "/login" });
							})
						}
					>
						Sign out
					</Button>
				</ItemActions>
			)}
		</Item>
	);
}
