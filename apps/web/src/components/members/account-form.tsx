import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Spinner } from "@nightshift/ui/components/spinner";
import { type ReactNode, useId, useState } from "react";

import { authClient } from "@/lib/auth-client";

/** The shortest password Better Auth takes. */
const PASSWORD_MIN = 8;

/**
 * Sign in, or make an account from an invitation. With `email` the email
 * is fixed: the invitation's. A new account names its invitation, because
 * Night Shift takes new people by invitation only.
 */
export function AccountForm({
	mode,
	email: fixedEmail,
	invitationId,
	submitLabel,
	onDone,
	footer,
}: {
	mode: "sign-in" | "sign-up";
	email?: string;
	invitationId?: string;
	submitLabel: string;
	/** Signed in: the session cookie is set. */
	onDone: () => Promise<void> | void;
	footer?: ReactNode;
}) {
	const id = useId();
	const [name, setName] = useState("");
	const [email, setEmail] = useState(fixedEmail ?? "");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	const ready =
		email.trim() !== "" &&
		password.length >= PASSWORD_MIN &&
		(mode === "sign-in" || name.trim() !== "");

	async function submit() {
		setPending(true);
		setError(null);
		const result =
			mode === "sign-in"
				? await authClient.signIn.email({ email: email.trim(), password })
				: await authClient.signUp.email({
						name: name.trim(),
						email: email.trim(),
						password,
						invitationId,
					} as Parameters<typeof authClient.signUp.email>[0]);
		if (result.error) {
			setPending(false);
			setError(
				result.error.message ??
					(mode === "sign-in"
						? "The email or the password is not correct."
						: "The account was not made. Try again."),
			);
			return;
		}
		try {
			await onDone();
		} finally {
			setPending(false);
		}
	}

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (ready && !pending) void submit();
			}}
		>
			<FieldGroup>
				{mode === "sign-up" ? (
					<Field>
						<FieldLabel htmlFor={`${id}-name`}>Your name</FieldLabel>
						<Input
							id={`${id}-name`}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Ada Lovelace"
							autoComplete="name"
							maxLength={80}
							autoFocus
						/>
						<FieldDescription>
							Members of the Space see it, and your commits in runs carry it.
						</FieldDescription>
					</Field>
				) : null}
				<Field>
					<FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
					<Input
						id={`${id}-email`}
						type="email"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						readOnly={fixedEmail !== undefined}
						autoComplete="email"
						autoFocus={mode === "sign-in" && fixedEmail === undefined}
					/>
				</Field>
				<Field data-invalid={error ? true : undefined}>
					<FieldLabel htmlFor={`${id}-password`}>Password</FieldLabel>
					<Input
						id={`${id}-password`}
						type="password"
						value={password}
						onChange={(event) => setPassword(event.target.value)}
						autoComplete={
							mode === "sign-in" ? "current-password" : "new-password"
						}
						autoFocus={mode === "sign-in" && fixedEmail !== undefined}
					/>
					{mode === "sign-up" ? (
						<FieldDescription>
							At least {PASSWORD_MIN} characters.
						</FieldDescription>
					) : null}
					{error ? <FieldError>{error}</FieldError> : null}
				</Field>
				<Field>
					<Button type="submit" disabled={!ready || pending}>
						{pending ? <Spinner data-icon="inline-start" /> : null}
						{submitLabel}
					</Button>
					{footer}
				</Field>
			</FieldGroup>
		</form>
	);
}
