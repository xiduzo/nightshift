import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useId, useState } from "react";

import { CODE_LENGTH, CodeInput } from "@/components/account/code-input";
import { authClient } from "@/lib/auth-client";
import { authErrorMessage, TRUSTED_BROWSER_DAYS } from "@/lib/two-factor";

/**
 * The second step of signing in, after a right password: the code from
 * the authenticator app, or a backup code. The browser can skip it for
 * a while when the person trusts it.
 */
export function TwoFactorChallenge({
	onDone,
	onStartOver,
}: {
	/** Signed in: the session cookie is set. */
	onDone: () => Promise<void> | void;
	/** Back to the email and the password. */
	onStartOver: () => void;
}) {
	const id = useId();
	const [backup, setBackup] = useState(false);
	const [code, setCode] = useState("");
	const [trust, setTrust] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const ready = backup ? code.trim().length > 0 : code.length === CODE_LENGTH;

	async function submit(value = code) {
		setPending(true);
		setError(null);
		const result = backup
			? await authClient.twoFactor.verifyBackupCode({
					code: value.trim(),
					trustDevice: trust,
				})
			: await authClient.twoFactor.verifyTotp({
					code: value,
					trustDevice: trust,
				});
		if (result.error) {
			setPending(false);
			setCode("");
			setError(authErrorMessage(result.error));
			return;
		}
		try {
			await onDone();
		} finally {
			setPending(false);
		}
	}

	function switchMode() {
		setBackup(!backup);
		setCode("");
		setError(null);
	}

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (ready && !pending) void submit();
			}}
		>
			<FieldGroup>
				<Field data-invalid={error ? true : undefined}>
					{backup ? (
						<>
							<FieldLabel htmlFor={`${id}-code`}>Backup code</FieldLabel>
							<Input
								id={`${id}-code`}
								value={code}
								onChange={(event) => setCode(event.target.value)}
								placeholder="abcde-12345"
								autoComplete="off"
								spellCheck={false}
								className="font-mono"
								aria-invalid={error ? true : undefined}
								autoFocus
							/>
							<FieldDescription>Each backup code works once.</FieldDescription>
						</>
					) : (
						<>
							<FieldLabel htmlFor={`${id}-code`}>
								Code from your authenticator app
							</FieldLabel>
							<CodeInput
								id={`${id}-code`}
								value={code}
								onChange={setCode}
								onComplete={(value) => {
									if (!pending) void submit(value);
								}}
								invalid={Boolean(error)}
								disabled={pending}
								autoFocus
							/>
							<FieldDescription>
								Open the app you use for Night Shift and enter the 6-digit code.
							</FieldDescription>
						</>
					)}
					{error ? <FieldError>{error}</FieldError> : null}
				</Field>
				<Field orientation="horizontal">
					<Checkbox
						id={`${id}-trust`}
						checked={trust}
						onCheckedChange={(checked) => setTrust(checked === true)}
					/>
					<FieldContent>
						<FieldLabel htmlFor={`${id}-trust`}>
							Trust this browser for {TRUSTED_BROWSER_DAYS} days
						</FieldLabel>
						<FieldDescription>
							You skip the code here. Do not use this on a shared computer.
						</FieldDescription>
					</FieldContent>
				</Field>
				<Field>
					<Button type="submit" disabled={!ready || pending}>
						{pending ? <Spinner data-icon="inline-start" /> : null}
						Sign in
					</Button>
					<Button type="button" variant="link" onClick={switchMode}>
						{backup ? "Use the code from your app" : "Use a backup code"}
					</Button>
					<Button type="button" variant="ghost" onClick={onStartOver}>
						Start over
					</Button>
				</Field>
			</FieldGroup>
		</form>
	);
}
