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
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
	FieldTitle,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQueryClient } from "@tanstack/react-query";
import {
	CopyIcon,
	ExternalLinkIcon,
	EyeIcon,
	ShieldCheckIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";

import { client } from "@/shared/api";

import { formatUserCode } from "./platform";
import { deviceQueries } from "./queries";

type Role = "home" | "guest";

/** Where the pairing is: the form, the code to enter on the Host, an error, or done. */
type Step =
	| { kind: "form"; error: string | null }
	| { kind: "starting" }
	| {
			kind: "code";
			userCode: string;
			/** The Host's page with the code filled in, when this computer can open it. */
			page: string | null;
			fingerprint: string | null;
			expiresAt: number;
	  }
	/** Paired with a home Host whose Host admin is someone else. */
	| { kind: "joined"; hostName: string };

/**
 * "Join a Host": pairs this computer with a Host. This computer asks the
 * Host for a code, the Person enters it on the Host, and this computer
 * stays connected to it from then on. The same as `nightshift join`.
 */
export function JoinHostDialog({
	open,
	onOpenChange,
	hasHome,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** This computer has a home Host already: a new one can only be a guest. */
	hasHome: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{open ? (
					<JoinHostSteps hasHome={hasHome} onDone={() => onOpenChange(false)} />
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function JoinHostSteps({
	hasHome,
	onDone,
}: {
	hasHome: boolean;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [address, setAddress] = useState("");
	const [role, setRole] = useState<Role>(hasHome ? "guest" : "home");
	const [step, setStep] = useState<Step>({ kind: "form", error: null });
	const pairing = useRef<AbortController | null>(null);

	// Closing the dialog stops the pairing: the code then expires unused.
	useEffect(() => () => pairing.current?.abort(), []);

	async function join(event: FormEvent) {
		event.preventDefault();
		const stop = new AbortController();
		pairing.current = stop;
		setStep({ kind: "starting" });
		try {
			const progress = await client.devices.join(
				{ url: address.trim(), role },
				{ signal: stop.signal },
			);
			for await (const next of progress) {
				if (next.kind === "code") {
					setStep({
						kind: "code",
						userCode: next.userCode,
						page: next.verificationUriComplete,
						fingerprint: next.fingerprint,
						expiresAt: next.expiresAt,
					});
				} else {
					void queryClient.invalidateQueries({
						queryKey: deviceQueries.overviewKey(),
					});
					if (next.role === "home" && next.hostAdmin === false) {
						setStep({ kind: "joined", hostName: next.hostName });
						return;
					}
					toast.success(`Paired with ${next.hostName}`);
					onDone();
					return;
				}
			}
		} catch (error) {
			if (stop.signal.aborted) return;
			setStep({
				kind: "form",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	if (step.kind === "code") {
		return <CodeStep step={step} />;
	}
	if (step.kind === "joined") {
		return <JoinedStep hostName={step.hostName} />;
	}

	const starting = step.kind === "starting";
	const error = step.kind === "form" ? step.error : null;
	return (
		<form onSubmit={join} className="flex flex-col gap-6">
			<DialogHeader>
				<DialogTitle>Join a Host</DialogTitle>
				<DialogDescription>
					Sync this computer through a Host: your other computer, a server, or a
					colleague's Night Shift.
				</DialogDescription>
			</DialogHeader>
			<FieldGroup>
				<Field data-invalid={error ? true : undefined}>
					<FieldLabel htmlFor={`${id}-address`}>Address of the Host</FieldLabel>
					<Input
						id={`${id}-address`}
						type="url"
						inputMode="url"
						autoComplete="url"
						placeholder="https://studio.example.com"
						value={address}
						onChange={(event) => setAddress(event.target.value)}
						disabled={starting}
						autoFocus
					/>
					{error ? (
						<FieldError>{error}</FieldError>
					) : (
						<FieldDescription>
							Any of the addresses on the Host's Devices page. This computer
							learns the others when it pairs.
						</FieldDescription>
					)}
				</Field>
				<FieldSet>
					<FieldLegend variant="label">What the Host keeps</FieldLegend>
					<RadioGroup
						value={role}
						onValueChange={(next) => setRole(next as Role)}
						disabled={starting}
					>
						<FieldLabel htmlFor={`${id}-home`}>
							<Field
								orientation="horizontal"
								data-disabled={hasHome || undefined}
							>
								<FieldContent>
									<FieldTitle>Home Host</FieldTitle>
									<FieldDescription>
										{hasHome
											? "This computer has a home Host already."
											: "Your own Host. It keeps the settings of this computer and syncs them to your other computers."}
									</FieldDescription>
								</FieldContent>
								<RadioGroupItem
									value="home"
									id={`${id}-home`}
									disabled={hasHome}
								/>
							</Field>
						</FieldLabel>
						<FieldLabel htmlFor={`${id}-guest`}>
							<Field orientation="horizontal">
								<FieldContent>
									<FieldTitle>Guest Host</FieldTitle>
									<FieldDescription>
										Someone else's Host. It gets only the Spaces you share
										there, never your settings.
									</FieldDescription>
								</FieldContent>
								<RadioGroupItem value="guest" id={`${id}-guest`} />
							</Field>
						</FieldLabel>
					</RadioGroup>
				</FieldSet>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={address.trim() === "" || starting}>
					{starting ? <Spinner data-icon="inline-start" /> : null}
					Join
				</Button>
			</DialogFooter>
		</form>
	);
}

/**
 * Paired with a home Host that someone else runs: its Host admin can read
 * this Person's personal runs there, so the Person reads that before the
 * dialog closes.
 */
function JoinedStep({ hostName }: { hostName: string }) {
	return (
		<>
			<DialogHeader>
				<DialogTitle>Paired with {hostName}</DialogTitle>
				<DialogDescription>
					This computer stays connected to it.
				</DialogDescription>
			</DialogHeader>
			<Alert>
				<EyeIcon />
				<AlertTitle>The Host admin can read your personal runs</AlertTitle>
				<AlertDescription>
					You are not the Host admin of {hostName}. Its Host admin can read your
					personal runs and their transcripts there.
				</AlertDescription>
			</Alert>
			<DialogFooter>
				<DialogClose render={<Button />}>Done</DialogClose>
			</DialogFooter>
		</>
	);
}

/**
 * The code to allow on the Host. With the Host's page, one click opens it
 * with the code filled in. Without it, the Person enters the code there.
 */
function CodeStep({ step }: { step: Extract<Step, { kind: "code" }> }) {
	const code = formatUserCode(step.userCode);
	async function copy() {
		try {
			await navigator.clipboard.writeText(code);
			toast.success("Code copied");
		} catch {
			toast.error("Could not copy. Allow this page to use the clipboard.");
		}
	}
	return (
		<>
			<DialogHeader>
				<DialogTitle>Allow this computer on the Host</DialogTitle>
				<DialogDescription>
					{step.page
						? "Open the Host, sign in, and allow this computer. It connects as soon as you do."
						: "On the Host, open Devices, choose Pair a device, and enter this code. This computer connects as soon as you allow it there."}
				</DialogDescription>
			</DialogHeader>
			<div className="flex items-center justify-center gap-2">
				<p className="font-mono font-semibold text-3xl tracking-widest">
					{code}
				</p>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Copy the code"
					onClick={() => void copy()}
				>
					<CopyIcon />
				</Button>
			</div>
			{step.fingerprint ? (
				<Alert>
					<ShieldCheckIcon />
					<AlertTitle>Check the fingerprint</AlertTitle>
					<AlertDescription>
						The Host uses its own certificate. Allow this computer only if the
						Host shows this fingerprint:
						<span className="mt-1 block break-all font-mono text-xs">
							{step.fingerprint}
						</span>
					</AlertDescription>
				</Alert>
			) : null}
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<Spinner />
				Keep this window open. The code works until{" "}
				{new Date(step.expiresAt).toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
				})}
				.
			</p>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
				{step.page ? (
					<Button
						nativeButton={false}
						render={<a href={step.page} target="_blank" rel="noreferrer" />}
					>
						Open the Host
						<ExternalLinkIcon data-icon="inline-end" />
					</Button>
				) : null}
			</DialogFooter>
		</>
	);
}
