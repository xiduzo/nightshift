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
import { useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon, CircleUserRoundIcon } from "lucide-react";
import { authClient } from "@/shared/api";
import { PageHeading, PageSection, SiteHeader } from "@/shared/page";
import { accountQueries } from "./queries";
import { TwoFactorSection } from "./two-factor-section";

/** You, and how you sign in: your email, two-factor sign-in, signing out. */
export function AccountPage() {
	// Not the session hook: it empties while it reloads, which would close
	// a dialog in the middle of the two-factor setup.
	const status = useQuery(accountQueries.status());
	const user = status.data?.person;

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
