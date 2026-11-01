import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemSeparator,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CircleAlertIcon,
	CopyIcon,
	LockIcon,
	MailIcon,
	PlusIcon,
	UserIcon,
	UserPlusIcon,
} from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import type {
	MembersOverview,
	PendingInvitation,
	SpaceMember,
	SpaceRole,
} from "@/shared/api";
import { formatDateTime } from "@/shared/format";
import { PageHeading, PageSection, SiteHeader } from "@/shared/page";
import { LocalTime } from "@/shared/time";
import { CreateSpaceDialog } from "./create-space-dialog";
import { copyInvitationLink, InviteDialog } from "./invite-dialog";
import { spaceMutations, spaceQueries } from "./queries";
import { ALL_ROLES, roleLabel } from "./roles";

export function MembersPage() {
	const overview = useQuery(spaceQueries.members());
	const [inviting, setInviting] = useState(false);
	const [creating, setCreating] = useState(false);
	const data = overview.data;
	const personal = data?.space.personal ?? false;

	return (
		<>
			<SiteHeader crumbs={[{ label: "Members" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="w-full max-w-4xl">
					<PageHeading
						title="Members"
						description={
							data && !personal
								? `The people in ${data.space.name}, and what each of them can do.`
								: "The people you share a Space with, and what each of them can do."
						}
						actions={
							data && !personal && data.can.invite ? (
								<Button size="sm" onClick={() => setInviting(true)}>
									<UserPlusIcon data-icon="inline-start" />
									Invite
								</Button>
							) : null
						}
					/>
				</div>
				<div className="flex w-full max-w-4xl flex-col gap-6">
					{overview.isLoading ? (
						<Skeleton className="h-48 w-full rounded-xl" />
					) : overview.error && !data ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>The members did not load</AlertTitle>
							<AlertDescription>{overview.error.message}</AlertDescription>
							<AlertAction>
								<Button
									variant="outline"
									size="sm"
									disabled={overview.isFetching}
									onClick={() => void overview.refetch()}
								>
									{overview.isFetching ? (
										<Spinner data-icon="inline-start" />
									) : null}
									Try again
								</Button>
							</AlertAction>
						</Alert>
					) : data && personal ? (
						<Card>
							<CardContent>
								<Empty>
									<EmptyHeader>
										<EmptyMedia variant="icon">
											<LockIcon />
										</EmptyMedia>
										<EmptyTitle>Your personal Space is private</EmptyTitle>
										<EmptyDescription>
											Nobody can join it. To work on projects with other people,
											create a Space and invite them there.
										</EmptyDescription>
									</EmptyHeader>
									<EmptyContent>
										<Button size="sm" onClick={() => setCreating(true)}>
											<PlusIcon data-icon="inline-start" />
											Create Space
										</Button>
									</EmptyContent>
								</Empty>
							</CardContent>
						</Card>
					) : data ? (
						<>
							<MemberList overview={data} />
							<Invitations overview={data} onInvite={() => setInviting(true)} />
						</>
					) : null}
				</div>
			</div>
			<InviteDialog
				open={inviting}
				onOpenChange={setInviting}
				spaceName={data?.space.name ?? ""}
			/>
			<CreateSpaceDialog open={creating} onOpenChange={setCreating} />
		</>
	);
}

function useRefreshMembers() {
	const queryClient = useQueryClient();
	return () =>
		void queryClient.invalidateQueries({ queryKey: spaceQueries.membersKey() });
}

/** The Members with their roles: change a role, or remove a Member. */
function MemberList({ overview }: { overview: MembersOverview }) {
	const refresh = useRefreshMembers();
	const [toRemove, setToRemove] = useState<SpaceMember | null>(null);
	const setRole = useMutation(
		spaceMutations.setRole({
			onSuccess: () => {
				toast.success("Role changed");
				refresh();
			},
			onError: (error) => toast.error(`Role not changed: ${error.message}`),
		}),
	);
	const remove = useMutation(
		spaceMutations.removeMember({
			onSuccess: () => {
				toast.success(`${toRemove?.name ?? "The member"} left the Space`);
				setToRemove(null);
				refresh();
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);

	return (
		<PageSection
			title="People"
			description="Everyone here sees the Space's projects, runs and gates."
		>
			<Card>
				<CardContent>
					<ItemGroup>
						{overview.members.map((member, index) => {
							const isYou = member.personId === overview.you;
							return (
								<Fragment key={member.id}>
									{index > 0 ? <ItemSeparator /> : null}
									<Item size="sm" className="px-0">
										<ItemMedia variant="icon">
											<UserIcon aria-hidden="true" />
										</ItemMedia>
										<ItemContent className="min-w-0">
											<ItemTitle>
												{member.name || member.email}
												{isYou ? <Badge variant="secondary">You</Badge> : null}
											</ItemTitle>
											<ItemDescription className="truncate">
												{member.email}. {roleLabel(member.role, "description")}
											</ItemDescription>
										</ItemContent>
										<ItemActions>
											{overview.can.changeRole && !isYou ? (
												<RoleSelect
													name={member.name}
													value={member.role}
													disabled={setRole.isPending}
													onChange={(role) =>
														setRole.mutate({ memberId: member.id, role })
													}
												/>
											) : (
												<Badge variant="outline">
													{roleLabel(member.role)}
												</Badge>
											)}
											{overview.can.remove && !isYou ? (
												<Button
													variant="outline"
													size="sm"
													onClick={() => setToRemove(member)}
												>
													Remove
												</Button>
											) : null}
										</ItemActions>
									</Item>
								</Fragment>
							);
						})}
					</ItemGroup>
				</CardContent>
			</Card>
			<AlertDialog
				open={toRemove !== null}
				onOpenChange={(open) => {
					if (!open) setToRemove(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove {toRemove?.name || toRemove?.email} from{" "}
							{overview.space.name}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							They no longer see its projects, runs and gates. Runs they started
							do not stop. To add them again, invite them.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => {
								if (toRemove) remove.mutate({ memberId: toRemove.id });
							}}
						>
							{remove.isPending ? <Spinner data-icon="inline-start" /> : null}
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageSection>
	);
}

function RoleSelect({
	name,
	value,
	disabled,
	onChange,
}: {
	name: string;
	value: SpaceRole;
	disabled: boolean;
	onChange: (role: SpaceRole) => void;
}) {
	return (
		<Select
			items={ALL_ROLES.map((role) => ({ value: role, label: roleLabel(role) }))}
			value={value}
			disabled={disabled}
			onValueChange={(next) => {
				if (next && next !== value) onChange(next as SpaceRole);
			}}
		>
			<SelectTrigger size="sm" className="w-28" aria-label={`Role of ${name}`}>
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				<SelectGroup>
					{ALL_ROLES.map((role) => (
						<SelectItem key={role} value={role}>
							{roleLabel(role)}
						</SelectItem>
					))}
				</SelectGroup>
			</SelectContent>
		</Select>
	);
}

/** Invitations nobody accepted yet: copy the link again, or cancel it. */
function Invitations({
	overview,
	onInvite,
}: {
	overview: MembersOverview;
	onInvite: () => void;
}) {
	const refresh = useRefreshMembers();
	const cancel = useMutation(
		spaceMutations.cancelInvitation({
			onSuccess: () => {
				toast.success("Invitation canceled");
				refresh();
			},
			onError: (error) => toast.error(`Not canceled: ${error.message}`),
		}),
	);
	if (!overview.can.invite && overview.invitations.length === 0) return null;

	return (
		<PageSection
			title="Invitations"
			description="Links to join that nobody accepted yet."
		>
			<Card>
				<CardContent>
					{overview.invitations.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<MailIcon />
								</EmptyMedia>
								<EmptyTitle>No open invitations</EmptyTitle>
								<EmptyDescription>
									Invite someone by email. You get a link to send them.
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button variant="outline" size="sm" onClick={onInvite}>
									<UserPlusIcon data-icon="inline-start" />
									Invite
								</Button>
							</EmptyContent>
						</Empty>
					) : (
						<ItemGroup>
							{overview.invitations.map((invitation, index) => (
								<Fragment key={invitation.id}>
									{index > 0 ? <ItemSeparator /> : null}
									<InvitationItem
										invitation={invitation}
										canCancel={overview.can.invite}
										canceling={cancel.isPending}
										onCancel={() =>
											cancel.mutate({ invitationId: invitation.id })
										}
									/>
								</Fragment>
							))}
						</ItemGroup>
					)}
				</CardContent>
			</Card>
		</PageSection>
	);
}

function InvitationItem({
	invitation,
	canCancel,
	canceling,
	onCancel,
}: {
	invitation: PendingInvitation;
	canCancel: boolean;
	canceling: boolean;
	onCancel: () => void;
}) {
	return (
		<Item size="sm" className="px-0">
			<ItemMedia variant="icon">
				<MailIcon aria-hidden="true" />
			</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle>
					{invitation.email}
					<Badge variant="outline">{roleLabel(invitation.role)}</Badge>
				</ItemTitle>
				<ItemDescription className="truncate">
					Invited by {invitation.inviterName}. The link works until{" "}
					<LocalTime at={invitation.expiresAt}>
						{formatDateTime(invitation.expiresAt)}
					</LocalTime>
					.
				</ItemDescription>
			</ItemContent>
			{canCancel ? (
				<ItemActions>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void copyInvitationLink(invitation.id)}
					>
						<CopyIcon data-icon="inline-start" />
						Copy link
					</Button>
					<Button
						variant="ghost"
						size="sm"
						disabled={canceling}
						onClick={onCancel}
					>
						Cancel
					</Button>
				</ItemActions>
			) : null}
		</Item>
	);
}
