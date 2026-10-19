import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
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
import { Spinner } from "@nightshift/ui/components/spinner";
import { CopyIcon } from "lucide-react";
import { useId, useState } from "react";
import QRCode from "react-qr-code";
import { toast } from "sonner";

import { BackupCodes } from "@/components/account/backup-codes";
import { CODE_LENGTH, CodeInput } from "@/components/account/code-input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, setupKeyOf } from "@/lib/two-factor";

type Step =
	| { kind: "password" }
	| { kind: "scan"; totpURI: string; backupCodes: string[] }
	| { kind: "backup-codes"; backupCodes: string[] };

/**
 * Turns two-factor sign-in on, step by step: the password, then the QR
 * code (or its setup key) and the first code from the app, then the
 * backup codes, shown once. Better Auth's two-factor endpoints do the
 * work, for a session from another computer and for this computer alike.
 */
export function TwoFactorSetup({
	email,
	onDone,
	submitLabel = "Done",
}: {
	/** The Person's email: the app shows it beside Night Shift. */
	email: string;
	/** Two-factor is on, and the person saved the backup codes. */
	onDone: () => Promise<void> | void;
	submitLabel?: string;
}) {
	const [step, setStep] = useState<Step>({ kind: "password" });

	if (step.kind === "password") {
		return (
			<PasswordStep
				onEnabled={(totpURI, backupCodes) =>
					setStep({ kind: "scan", totpURI, backupCodes })
				}
			/>
		);
	}
	if (step.kind === "scan") {
		return (
			<ScanStep
				totpURI={step.totpURI}
				onVerified={() =>
					setStep({ kind: "backup-codes", backupCodes: step.backupCodes })
				}
			/>
		);
	}
	return (
		<SaveCodesStep
			codes={step.backupCodes}
			email={email}
			submitLabel={submitLabel}
			onDone={onDone}
		/>
	);
}

/** Confirms the password: the answer is the setup link and the backup codes. */
function PasswordStep({
	onEnabled,
}: {
	onEnabled: (totpURI: string, backupCodes: string[]) => void;
}) {
	const id = useId();
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function submit() {
		setPending(true);
		setError(null);
		const result = await authClient.twoFactor.enable({ password });
		setPending(false);
		if (result.error || !result.data) {
			setError(authErrorMessage(result.error));
			return;
		}
		const data = result.data as { totpURI?: string; backupCodes?: string[] };
		if (!data.totpURI || !data.backupCodes) {
			setError("Something went wrong. Try again.");
			return;
		}
		onEnabled(data.totpURI, data.backupCodes);
	}

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (password && !pending) void submit();
			}}
		>
			<FieldGroup>
				<Field data-invalid={error ? true : undefined}>
					<FieldLabel htmlFor={`${id}-password`}>Your password</FieldLabel>
					<Input
						id={`${id}-password`}
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						autoComplete="current-password"
						aria-invalid={error ? true : undefined}
						autoFocus
					/>
					<FieldDescription>
						Enter it again to show that it is you.
					</FieldDescription>
					{error ? <FieldError>{error}</FieldError> : null}
				</Field>
				<Field>
					<Button type="submit" disabled={!password || pending}>
						{pending ? <Spinner data-icon="inline-start" /> : null}
						Continue
					</Button>
				</Field>
			</FieldGroup>
		</form>
	);
}

/** The QR code and its setup key, then the first code: right, and two-factor is on. */
function ScanStep({
	totpURI,
	onVerified,
}: {
	totpURI: string;
	onVerified: () => void;
}) {
	const id = useId();
	const key = setupKeyOf(totpURI);
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function submit(value = code) {
		setPending(true);
		setError(null);
		const result = await authClient.twoFactor.verifyTotp({ code: value });
		setPending(false);
		if (result.error) {
			setCode("");
			setError(authErrorMessage(result.error));
			return;
		}
		onVerified();
	}

	async function copyKey() {
		try {
			await navigator.clipboard.writeText(key.replaceAll(" ", ""));
			toast.success("Setup key copied");
		} catch {
			toast.error("Could not copy. Allow this page to use the clipboard.");
		}
	}

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (code.length === CODE_LENGTH && !pending) void submit();
			}}
		>
			<FieldGroup>
				<Field>
					<FieldLabel>Scan this QR code with your authenticator app</FieldLabel>
					<div className="w-fit rounded-md bg-white p-3">
						<QRCode
							value={totpURI}
							size={168}
							title="QR code for your authenticator app"
						/>
					</div>
					<FieldDescription>
						Use any authenticator app, for example 1Password, Google
						Authenticator or Authy.
					</FieldDescription>
				</Field>
				<Field>
					<FieldLabel htmlFor={`${id}-key`}>
						Cannot scan? Enter this setup key
					</FieldLabel>
					<InputGroup>
						<InputGroupInput
							id={`${id}-key`}
							value={key}
							readOnly
							className="font-mono text-xs"
							onFocus={(event) => event.currentTarget.select()}
						/>
						<InputGroupAddon align="inline-end">
							<InputGroupButton
								aria-label="Copy the setup key"
								onClick={() => void copyKey()}
							>
								<CopyIcon />
							</InputGroupButton>
						</InputGroupAddon>
					</InputGroup>
				</Field>
				<Field data-invalid={error ? true : undefined}>
					<FieldLabel htmlFor={`${id}-code`}>Code from the app</FieldLabel>
					<CodeInput
						id={`${id}-code`}
						value={code}
						onChange={setCode}
						onComplete={(value) => {
							if (!pending) void submit(value);
						}}
						invalid={Boolean(error)}
						disabled={pending}
					/>
					<FieldDescription>
						Enter the 6-digit code the app shows for Night Shift.
					</FieldDescription>
					{error ? <FieldError>{error}</FieldError> : null}
				</Field>
				<Field>
					<Button
						type="submit"
						disabled={code.length !== CODE_LENGTH || pending}
					>
						{pending ? <Spinner data-icon="inline-start" /> : null}
						Turn on
					</Button>
				</Field>
			</FieldGroup>
		</form>
	);
}

/** The backup codes, once. Done waits until the person says they saved them. */
function SaveCodesStep({
	codes,
	email,
	submitLabel,
	onDone,
}: {
	codes: string[];
	email: string;
	submitLabel: string;
	onDone: () => Promise<void> | void;
}) {
	const id = useId();
	const [saved, setSaved] = useState(false);
	const [pending, setPending] = useState(false);

	async function finish() {
		setPending(true);
		// Browsers that signed in with the password alone sign in again.
		await authClient.revokeOtherSessions().catch(() => undefined);
		try {
			await onDone();
		} finally {
			setPending(false);
		}
	}

	return (
		<FieldGroup>
			<Field>
				<FieldLabel>Save your backup codes</FieldLabel>
				<FieldDescription>
					Each code signs you in once when you do not have your app. You see
					them only now.
				</FieldDescription>
				<BackupCodes
					codes={codes}
					email={email}
					onSaved={() => setSaved(true)}
				/>
			</Field>
			<Field orientation="horizontal">
				<Checkbox
					id={`${id}-saved`}
					checked={saved}
					onCheckedChange={(checked) => setSaved(checked === true)}
				/>
				<FieldLabel htmlFor={`${id}-saved`}>
					I saved my backup codes in a safe place
				</FieldLabel>
			</Field>
			<Field>
				<Button
					type="button"
					disabled={!saved || pending}
					onClick={() => void finish()}
				>
					{pending ? <Spinner data-icon="inline-start" /> : null}
					{submitLabel}
				</Button>
				<FieldDescription>
					Night Shift signs you out on your other browsers.
				</FieldDescription>
			</Field>
		</FieldGroup>
	);
}
