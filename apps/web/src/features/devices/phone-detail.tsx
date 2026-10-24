import { platformName } from "@nightshift/client";
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
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { SmartphoneIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Phone } from "@/shared/api";
import { DetailSection, DetailShell } from "@/shared/detail";
import { formatRelative, useNow } from "@/shared/format";
import { deviceMutations, deviceQueries } from "./queries";

/**
 * One of your phones on the Host of the Space: the Night Shift app signed
 * in there as you. It reads and answers. It runs nothing, so it is the
 * Host's, not a computer of the Space.
 */
export function PhoneDetail({
	phone,
	hostName,
}: {
	phone: Phone;
	hostName: string;
}) {
	const now = useNow(30_000);
	const [signingOut, setSigningOut] = useState(false);
	return (
		<DetailShell
			icon={<SmartphoneIcon />}
			kicker={`Your phone on ${hostName}`}
			title={phone.name}
			subtitle={[
				phone.platform ? `${platformName(phone.platform)}.` : null,
				phone.lastSeenAt
					? `Last seen ${formatRelative(phone.lastSeenAt, now)}.`
					: null,
			]
				.filter(Boolean)
				.join(" ")}
			actions={[
				{
					label: "Sign out",
					destructive: true,
					onSelect: () => setSigningOut(true),
				},
			]}
		>
			<DetailSection
				title="What it does"
				description="A phone signs in to a Host."
			>
				<p className="text-sm">
					It shows the runs and Gates of your Spaces on {hostName}, and tells
					you when a Gate waits. You can start a run and answer a Gate from it.
					It runs no steps.
				</p>
			</DetailSection>
			<SignOutDialog
				phone={phone}
				open={signingOut}
				onOpenChange={setSigningOut}
			/>
		</DetailShell>
	);
}

function SignOutDialog({
	phone,
	open,
	onOpenChange,
}: {
	phone: Phone;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const signOut = useMutation(
		deviceMutations.removePhone({
			onSuccess: () => {
				toast.success(`${phone.name} is signed out`);
				onOpenChange(false);
				void queryClient.invalidateQueries({
					queryKey: deviceQueries.phonesKey(),
				});
			},
			onError: (error) => toast.error(`Not signed out: ${error.message}`),
		}),
	);
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Sign out {phone.name}?</AlertDialogTitle>
					<AlertDialogDescription>
						It gets no more notifications. To use it again, sign in on the
						phone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={signOut.isPending}
						onClick={() => signOut.mutate({ id: phone.id })}
					>
						{signOut.isPending ? <Spinner data-icon="inline-start" /> : null}
						Sign out
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
