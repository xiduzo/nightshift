import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupInput,
} from "@nightshift/ui/components/input-group";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CopyIcon, SendIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/shared/api";
import { INVITE_ROLES, roleLabel } from "./roles";

/** The link that opens an invitation: its id is the secret. */
export function invitationLink(invitationId: string): string {
	return `${window.location.origin}/invite/${invitationId}`;
}

/** Copies an invitation's link, with a toast that says so. */
export async function copyInvitationLink(invitationId: string) {
	try {
		await navigator.clipboard.writeText(invitationLink(invitationId));
		toast.success("Invitation link copied");
	} catch {
		toast.error("Could not copy. Allow this page to use the clipboard.");
	}
}

/**
 * Invites a person to the Space by email, with a role. Night Shift sends
 * no email: the dialog then shows the link to send them.
 */
export function InviteDialog({
	open,
	onOpenChange,
	spaceName,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	spaceName: string;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{open ? <InviteForm spaceName={spaceName} /> : null}
			</DialogContent>
		</Dialog>
	);
}

type InviteRole = (typeof INVITE_ROLES)[number];

function InviteForm({ spaceName }: { spaceName: string }) {
	const id = useId();
	const queryClient = useQueryClient();
	const [email, setEmail] = useState("");
	const [role, setRole] = useState<InviteRole>("member");
	const invite = useMutation(
		orpc.members.invite.mutationOptions({
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: orpc.members.list.key(),
				});
			},
		}),
	);

	if (invite.data) {
		const link = invitationLink(invite.data.id);
		return (
			<>
				<DialogHeader>
					<DialogTitle>Send this link to {email.trim()}</DialogTitle>
					<DialogDescription>
						Night Shift does not send email. Share the link in a message. It
						works for this email only, for seven days.
					</DialogDescription>
				</DialogHeader>
				<Field>
					<FieldLabel htmlFor={`${id}-link`}>Invitation link</FieldLabel>
					<InputGroup>
						<InputGroupInput
							id={`${id}-link`}
							value={link}
							readOnly
							className="font-mono text-xs"
							onFocus={(event) => event.currentTarget.select()}
						/>
						<InputGroupAddon align="inline-end">
							<InputGroupButton
								aria-label="Copy the invitation link"
								onClick={() => void copyInvitationLink(invite.data.id)}
							>
								<CopyIcon />
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
					<FieldDescription>
						You find it again under Invitations until they accept it.
					</FieldDescription>
				</Field>
				<DialogFooter>
					<DialogClose render={<Button type="button" />}>Done</DialogClose>
				</DialogFooter>
			</>
		);
	}

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (email.trim() !== "") invite.mutate({ email: email.trim(), role });
			}}
		>
			<DialogHeader>
				<DialogTitle>Invite to {spaceName}</DialogTitle>
				<DialogDescription>
					They get a link to make an account here and join this Space.
				</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field data-invalid={invite.error ? true : undefined}>
					<FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
					<Input
						id={`${id}-email`}
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						placeholder="colleague@example.com"
						autoComplete="off"
						autoFocus
					/>
					{invite.error ? (
						<FieldError>{invite.error.message}</FieldError>
					) : null}
				</Field>
				<Field>
					<FieldLabel htmlFor={`${id}-role`}>Role</FieldLabel>
					<Select
						items={INVITE_ROLES.map((value) => ({
							value,
							label: roleLabel(value),
						}))}
						value={role}
						onValueChange={(value) => {
							if (value) setRole(value as InviteRole);
						}}
					>
						<SelectTrigger id={`${id}-role`} className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								{INVITE_ROLES.map((value) => (
									<SelectItem key={value} value={value}>
										{roleLabel(value)}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
					<FieldDescription>{roleLabel(role, "description")}</FieldDescription>
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button
					type="submit"
					disabled={email.trim() === "" || invite.isPending}
				>
					{invite.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<SendIcon data-icon="inline-start" />
					)}
					Invite
				</Button>
			</DialogFooter>
		</form>
	);
}
