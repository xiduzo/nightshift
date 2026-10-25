import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { MailXIcon } from "lucide-react";
import { toast } from "sonner";

import { AccountForm } from "@/features/access";
import type { InvitationView } from "@/shared/api";
import { authClient } from "@/shared/api";
import { spaceMutations, spaceQueries } from "./queries";
import { roleLabel } from "./roles";
import { useSpaceChanged } from "./space-tabs";

/**
 * The page of an invitation link. The invited person makes their account
 * here (or signs in with the one they have), joins the Space, and works
 * in it from then on.
 */
export function InvitePage({ invitationId }: { invitationId: string }) {
	const invitation = useQuery({
		...spaceQueries.invitation(invitationId),
		retry: false,
	});

	return (
		<div className="flex min-h-svh items-center justify-center p-4 md:p-6">
			<div className="w-full max-w-sm">
				{invitation.isLoading ? (
					<Skeleton className="h-96 w-full rounded-xl" />
				) : invitation.data?.status === "pending" ? (
					<PendingInvitation invitation={invitation.data} />
				) : (
					<ClosedInvitation
						status={invitation.data?.status ?? null}
						spaceName={invitation.data?.spaceName ?? null}
					/>
				)}
			</div>
		</div>
	);
}

function PendingInvitation({ invitation }: { invitation: InvitationView }) {
	const navigate = useNavigate();
	const spaceChanged = useSpaceChanged();
	const session = authClient.useSession();
	const signedInAs = session.data?.user.email ?? null;
	const isInvitee =
		signedInAs !== null &&
		signedInAs.toLowerCase() === invitation.email.toLowerCase();

	const accept = useMutation(
		spaceMutations.acceptInvitation({
			onSuccess: async () => {
				toast.success(`You joined ${invitation.spaceName}`);
				// You work in the Space now: every page shows it.
				await spaceChanged();
				await navigate({ to: "/" });
			},
			onError: (error) => toast.error(`Not joined: ${error.message}`),
		}),
	);
	// A refusal shows as a toast (`onError`).
	const join = () =>
		accept.mutateAsync({ invitationId: invitation.id }).catch(() => undefined);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Join {invitation.spaceName}</CardTitle>
				<CardDescription>
					{invitation.inviterName} invites you as{" "}
					{roleLabel(invitation.role).toLowerCase()}.{" "}
					{roleLabel(invitation.role, "description")}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{session.isPending ? (
					<Skeleton className="h-40 w-full" />
				) : isInvitee ? (
					<Button disabled={accept.isPending} onClick={() => void join()}>
						{accept.isPending ? <Spinner data-icon="inline-start" /> : null}
						Join {invitation.spaceName}
					</Button>
				) : (
					<>
						{signedInAs ? (
							<Alert>
								<AlertDescription>
									You are signed in as {signedInAs}. This invitation is for{" "}
									{invitation.email}.
								</AlertDescription>
							</Alert>
						) : null}
						<AccountForm
							key={invitation.hasAccount ? "sign-in" : "sign-up"}
							mode={invitation.hasAccount ? "sign-in" : "sign-up"}
							email={invitation.email}
							invitationId={invitation.id}
							submitLabel={
								invitation.hasAccount
									? "Sign in and join"
									: "Create account and join"
							}
							onDone={async () => {
								await join();
							}}
						/>
					</>
				)}
			</CardContent>
		</Card>
	);
}

function ClosedInvitation({
	status,
	spaceName,
}: {
	status: InvitationView["status"] | null;
	spaceName: string | null;
}) {
	const { title, description } =
		status === "accepted"
			? {
					title: "You accepted this invitation",
					description: `Sign in to work in ${spaceName ?? "the Space"}.`,
				}
			: status === "expired"
				? {
						title: "This invitation expired",
						description: "Ask the person who invited you for a new one.",
					}
				: status === null
					? {
							title: "This invitation does not exist",
							description:
								"Check that you opened the whole link, or ask for a new one.",
						}
					: {
							title: "This invitation is no longer valid",
							description: "Ask the person who invited you for a new one.",
						};
	return (
		<Empty className="border">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<MailXIcon />
				</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
			{status === "accepted" ? (
				<EmptyContent>
					<Button variant="outline" size="sm" render={<Link to="/login" />}>
						Sign in
					</Button>
				</EmptyContent>
			) : null}
		</Empty>
	);
}
