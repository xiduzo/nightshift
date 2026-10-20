import {
	Alert,
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
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShareIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { PermissionMode } from "@/shared/api";
import { orpc } from "@/shared/api";
import { PERMISSION_MODES } from "./agent-options";

/** The permission modes from the narrowest to the widest, as an Offer caps them. */
const CAPS: PermissionMode[] = [
	"plan",
	"default",
	"acceptEdits",
	"auto",
	"bypassPermissions",
];

/**
 * "Offer to a Space…" on a profile: people in a shared Space may run
 * this profile on this computer, within the caps. It says plainly what
 * an Offer cannot hide: the agent runs with your login and your tools.
 */
export function OfferDialog({
	profile,
	open,
	onOpenChange,
}: {
	profile: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				{open ? (
					<OfferForm profile={profile} onDone={() => onOpenChange(false)} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function OfferForm({
	profile,
	onDone,
}: {
	profile: string;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const listed = useQuery(orpc.offers.list.queryOptions());
	const spaces = listed.data?.spaces ?? [];
	const [spaceId, setSpaceId] = useState<string | null>(null);
	const space = spaceId ?? spaces[0]?.id ?? "";
	const [cap, setCap] = useState<PermissionMode>("acceptEdits");
	const [sessions, setSessions] = useState("1");
	const sessionCap = Number(sessions);
	const sessionsValid =
		Number.isInteger(sessionCap) && sessionCap >= 1 && sessionCap <= 16;
	const make = useMutation(
		orpc.offers.make.mutationOptions({
			onSuccess: () => {
				toast.success(
					`Offered ${profile} to ${spaces.find((s) => s.id === space)?.name ?? "the Space"}`,
				);
				void queryClient.invalidateQueries({ queryKey: orpc.offers.key() });
				onDone();
			},
		}),
	);

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (space && sessionsValid) {
					make.mutate({
						spaceId: space,
						profile,
						permissionCap: cap,
						sessionCap,
					});
				}
			}}
		>
			<DialogHeader>
				<DialogTitle>Offer {profile} to a Space</DialogTitle>
				<DialogDescription>
					People in the Space can run this profile on this computer, within the
					limits you set. You can withdraw it at any time.
				</DialogDescription>
			</DialogHeader>
			<Alert>
				<TriangleAlertIcon />
				<AlertTitle>The agent runs with your login and your tools</AlertTitle>
				<AlertDescription>
					A <code>gh pr create</code> in a flow a colleague wrote uses your{" "}
					<code>gh</code>. Offer a profile only if you would hand its tools to
					the people in that Space.
				</AlertDescription>
			</Alert>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor={`${id}-space`}>Space</FieldLabel>
					<NativeSelect
						id={`${id}-space`}
						value={space}
						onChange={(event) => setSpaceId(event.target.value)}
						disabled={spaces.length === 0}
					>
						{spaces.map((s) => (
							<NativeSelectOption key={s.id} value={s.id}>
								{s.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
					{!listed.isLoading && spaces.length === 0 ? (
						<FieldDescription>
							You can offer to a shared Space where you are an owner or an
							admin. Create one in the Space switcher.
						</FieldDescription>
					) : null}
				</Field>
				<Field>
					<FieldLabel htmlFor={`${id}-cap`}>
						Permission mode, at most
					</FieldLabel>
					<NativeSelect
						id={`${id}-cap`}
						value={cap}
						onChange={(event) => setCap(event.target.value as PermissionMode)}
					>
						{CAPS.map((mode) => (
							<NativeSelectOption key={mode} value={mode}>
								{PERMISSION_MODES.find((m) => m.value === mode)?.label ?? mode}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<FieldDescription>
						A run that asks for more gets this mode.
					</FieldDescription>
				</Field>
				<Field data-invalid={sessionsValid ? undefined : true}>
					<FieldLabel htmlFor={`${id}-sessions`}>Sessions at once</FieldLabel>
					<Input
						id={`${id}-sessions`}
						type="number"
						min={1}
						max={16}
						value={sessions}
						onChange={(event) => setSessions(event.target.value)}
						className="w-24"
						aria-invalid={sessionsValid ? undefined : true}
					/>
					{sessionsValid ? (
						<FieldDescription>
							More sessions wait until one ends.
						</FieldDescription>
					) : (
						<FieldError>Enter a number from 1 to 16.</FieldError>
					)}
				</Field>
				{make.error ? <FieldError>{make.error.message}</FieldError> : null}
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button
					type="submit"
					disabled={!space || !sessionsValid || make.isPending}
				>
					{make.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<ShareIcon data-icon="inline-start" />
					)}
					Offer profile
				</Button>
			</DialogFooter>
		</form>
	);
}

/** Asks before an Offer ends: its running steps stop. */
export function WithdrawOfferDialog({
	offer,
	onOpenChange,
}: {
	/** The Offer to withdraw; null: closed. */
	offer: { spaceId: string; spaceName: string; profile: string } | null;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const withdraw = useMutation(
		orpc.offers.withdraw.mutationOptions({
			onSuccess: () => {
				toast.success(`Withdrew ${offer?.profile} from ${offer?.spaceName}`);
				onOpenChange(false);
			},
			onError: (error) => toast.error(`Not withdrawn: ${error.message}`),
			onSettled: () =>
				queryClient.invalidateQueries({ queryKey: orpc.offers.key() }),
		}),
	);
	return (
		<AlertDialog open={offer !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Withdraw {offer?.profile} from {offer?.spaceName}?
					</AlertDialogTitle>
					<AlertDialogDescription>
						People in the Space can no longer run it on this computer. Steps
						that run it now stop.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={withdraw.isPending}
						onClick={() => {
							if (offer) {
								withdraw.mutate({
									spaceId: offer.spaceId,
									profile: offer.profile,
								});
							}
						}}
					>
						{withdraw.isPending ? <Spinner data-icon="inline-start" /> : null}
						Withdraw
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
