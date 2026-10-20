import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
import {
	InputOTP,
	InputOTPGroup,
	InputOTPSeparator,
	InputOTPSlot,
} from "@nightshift/ui/components/input-otp";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LaptopIcon, ShieldCheckIcon } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import type { PairingReview } from "@/shared/api";

import { formatUserCode, platformName } from "./platform";
import { deviceMutations, deviceQueries } from "./queries";

/**
 * "Pair a device": the Person enters the code their other computer shows,
 * sees which computer asks, and allows or declines it. Entering the code
 * holds it for this Person: nobody else can answer it after that.
 */
export function PairDeviceDialog({
	open,
	onOpenChange,
	initialCode,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** A code from the link the device printed. */
	initialCode?: string;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{open ? (
					<PairDeviceSteps
						initialCode={initialCode ?? ""}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function PairDeviceSteps({
	initialCode,
	onDone,
}: {
	initialCode: string;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [code, setCode] = useState(cleanCode(initialCode));
	const [review, setReview] = useState<PairingReview | null>(null);

	const find = useMutation(deviceMutations.review({ onSuccess: setReview }));
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: deviceQueries.overviewKey() });
	const allow = useMutation(
		deviceMutations.approve({
			onSuccess: () => {
				toast.success(`${review?.device.name ?? "The device"} is paired`);
				void refresh();
				onDone();
			},
		}),
	);
	const decline = useMutation(
		deviceMutations.deny({
			onSuccess: () => {
				toast("The device was declined");
				onDone();
			},
		}),
	);

	// A link with the whole code opens on the device to allow, not the form.
	const linked = useRef(false);
	useEffect(() => {
		if (linked.current) return;
		linked.current = true;
		const fromLink = cleanCode(initialCode);
		if (fromLink.length === 8) find.mutate({ userCode: fromLink });
	}, [initialCode, find.mutate]);

	function submit(event: FormEvent) {
		event.preventDefault();
		if (code.length === 8) find.mutate({ userCode: code });
	}

	if (review) {
		const name = review.device.name ?? "A device";
		const busy = allow.isPending || decline.isPending;
		return (
			<>
				<DialogHeader>
					<DialogTitle>Allow {name}?</DialogTitle>
					<DialogDescription>
						It can then sync with this computer as yours. You can remove its
						access at any time.
					</DialogDescription>
				</DialogHeader>
				<Item variant="outline">
					<ItemMedia variant="icon">
						<LaptopIcon aria-hidden="true" />
					</ItemMedia>
					<ItemContent>
						<ItemTitle>{name}</ItemTitle>
						<ItemDescription>
							{platformName(review.device.platform)}, code{" "}
							<span className="font-mono">
								{formatUserCode(review.userCode)}
							</span>
						</ItemDescription>
					</ItemContent>
				</Item>
				{review.fingerprint ? (
					<Alert>
						<ShieldCheckIcon />
						<AlertTitle>Check the fingerprint</AlertTitle>
						<AlertDescription>
							The device shows a fingerprint next to the code. Allow it only if
							it is this one:
							<span className="mt-1 block break-all font-mono text-xs">
								{review.fingerprint}
							</span>
						</AlertDescription>
					</Alert>
				) : null}
				{allow.error || decline.error ? (
					<FieldError>{(allow.error ?? decline.error)?.message}</FieldError>
				) : null}
				<DialogFooter>
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => decline.mutate({ userCode: review.userCode })}
					>
						{decline.isPending ? <Spinner data-icon="inline-start" /> : null}
						Decline
					</Button>
					<Button
						disabled={busy}
						onClick={() => allow.mutate({ userCode: review.userCode })}
					>
						{allow.isPending ? <Spinner data-icon="inline-start" /> : null}
						Allow
					</Button>
				</DialogFooter>
			</>
		);
	}

	return (
		<form onSubmit={submit} className="flex flex-col gap-6">
			<DialogHeader>
				<DialogTitle>Pair a device</DialogTitle>
				<DialogDescription>
					On the other computer, open Devices and choose Join a Host, or run{" "}
					<span className="font-mono">nightshift join</span>, with the address
					of this one. Enter the code it shows.
				</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field data-invalid={find.error ? true : undefined}>
					<FieldLabel htmlFor={id}>Code</FieldLabel>
					<InputOTP
						id={id}
						maxLength={8}
						pattern={CODE_PATTERN}
						value={code}
						onChange={(value) => setCode(cleanCode(value))}
						autoFocus
					>
						<InputOTPGroup>
							{[0, 1, 2, 3].map((index) => (
								<InputOTPSlot key={index} index={index} />
							))}
						</InputOTPGroup>
						<InputOTPSeparator />
						<InputOTPGroup>
							{[4, 5, 6, 7].map((index) => (
								<InputOTPSlot key={index} index={index} />
							))}
						</InputOTPGroup>
					</InputOTP>
					{find.error ? (
						<FieldError>{find.error.message}</FieldError>
					) : (
						<FieldDescription>
							Eight letters and digits, for example ABCD-1234.
						</FieldDescription>
					)}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={code.length !== 8 || find.isPending}>
					{find.isPending ? <Spinner data-icon="inline-start" /> : null}
					Continue
				</Button>
			</DialogFooter>
		</form>
	);
}

/** What a code slot takes: a letter or a digit. */
const CODE_PATTERN = "^[a-zA-Z0-9]+$";

/** Letters and digits only, in upper case, at most eight. */
function cleanCode(value: string): string {
	return value
		.replace(/[^a-zA-Z0-9]/g, "")
		.toUpperCase()
		.slice(0, 8);
}
