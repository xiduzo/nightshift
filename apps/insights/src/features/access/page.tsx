import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@nightshift/ui/components/dialog";
import {
	Field,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { useRouter } from "@tanstack/react-router";
import { useId, useState } from "react";

import { authClient } from "@/shared/api";

/** Email, password, and GitHub. A second factor follows the password. */
export function LoginPage({ githubFailed }: { githubFailed: boolean }) {
	const router = useRouter();
	const id = useId();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(
		githubFailed ? "GitHub did not sign you in." : null,
	);
	const [pending, setPending] = useState(false);
	const [challenge, setChallenge] = useState(false);

	async function submit() {
		setPending(true);
		setError(null);
		const result = await authClient.signIn.email({
			email: email.trim(),
			password,
		});
		setPending(false);
		if (result.error) {
			setError("That email or password is not correct.");
			return;
		}
		if (
			result.data &&
			"twoFactorRedirect" in result.data &&
			result.data.twoFactorRedirect
		) {
			setChallenge(true);
			return;
		}
		await router.navigate({ to: "/" });
	}

	return (
		<div className="flex min-h-svh items-center justify-center p-6">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>Sign in</CardTitle>
					<CardDescription>
						Sign in to read usage for Night Shift.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{challenge ? (
						<CodeForm
							onDone={() => router.navigate({ to: "/" })}
							onStartOver={() => {
								setChallenge(false);
								setPassword("");
							}}
						/>
					) : (
						<form
							onSubmit={(event) => {
								event.preventDefault();
								if (email.trim() !== "" && password !== "" && !pending) {
									void submit();
								}
							}}
						>
							<FieldGroup>
								<Field data-invalid={error ? true : undefined}>
									<FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
									<Input
										id={`${id}-email`}
										type="email"
										autoComplete="email"
										value={email}
										onChange={(event) => setEmail(event.target.value)}
									/>
								</Field>
								<Field>
									<FieldLabel htmlFor={`${id}-password`}>Password</FieldLabel>
									<Input
										id={`${id}-password`}
										type="password"
										autoComplete="current-password"
										value={password}
										onChange={(event) => setPassword(event.target.value)}
									/>
									{error ? <FieldError>{error}</FieldError> : null}
								</Field>
								<Button
									type="submit"
									disabled={email.trim() === "" || password === "" || pending}
								>
									Sign in
								</Button>
								<Button
									type="button"
									variant="outline"
									onClick={() => {
										void authClient.signIn.social({
											provider: "github",
											callbackURL: "/",
											errorCallbackURL: "/login",
										});
									}}
								>
									Sign in with GitHub
								</Button>
							</FieldGroup>
						</form>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function CodeForm({
	onDone,
	onStartOver,
}: {
	onDone: () => Promise<void>;
	onStartOver: () => void;
}) {
	const id = useId();
	const [code, setCode] = useState("");
	const [backup, setBackup] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function submit() {
		setPending(true);
		setError(null);
		const result = backup
			? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
			: await authClient.twoFactor.verifyTotp({ code: code.trim() });
		setPending(false);
		if (result.error) {
			setError("That code is not correct.");
			return;
		}
		await onDone();
	}

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (code.trim() !== "" && !pending) void submit();
			}}
		>
			<FieldGroup>
				<Field data-invalid={error ? true : undefined}>
					<FieldLabel htmlFor={`${id}-code`}>Code</FieldLabel>
					<p className="text-muted-foreground text-sm">
						Enter the code from your authenticator app.
					</p>
					<Input
						id={`${id}-code`}
						autoComplete="one-time-code"
						value={code}
						onChange={(event) => setCode(event.target.value)}
					/>
					{error ? <FieldError>{error}</FieldError> : null}
				</Field>
				<Button type="submit" disabled={code.trim() === "" || pending}>
					Confirm code
				</Button>
				<Button
					type="button"
					variant="outline"
					onClick={() => {
						setBackup((value) => !value);
						setError(null);
					}}
				>
					{backup ? "Use an app code" : "Use a backup code"}
				</Button>
				<Button type="button" variant="ghost" onClick={onStartOver}>
					Start over
				</Button>
			</FieldGroup>
		</form>
	);
}

/** Turns on a second factor for the signed-in person. */
export function SecondFactor() {
	const id = useId();
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [uri, setUri] = useState<string | null>(null);
	const [backupCodes, setBackupCodes] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [done, setDone] = useState(false);
	const [pending, setPending] = useState(false);

	async function enable() {
		setPending(true);
		setError(null);
		const result = await authClient.twoFactor.enable({ password });
		setPending(false);
		if (result.error || result.data?.method !== "totp") {
			setError("The second factor did not start. Try again.");
			return;
		}
		setUri(result.data.totpURI);
		setBackupCodes(result.data.backupCodes);
		setPassword("");
	}

	async function confirm() {
		setPending(true);
		setError(null);
		const result = await authClient.twoFactor.verifyTotp({ code: code.trim() });
		setPending(false);
		if (result.error) {
			setError("That code is not correct.");
			return;
		}
		setDone(true);
	}

	return (
		<Dialog>
			<DialogTrigger render={<Button variant="outline" />}>
				Add a second factor
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add a second factor</DialogTitle>
					<DialogDescription>
						Enter your password. Then enter the code from your app.
					</DialogDescription>
				</DialogHeader>
				{done ? (
					<p>Second factor is on.</p>
				) : (
					<FieldGroup>
						{uri ? (
							<>
								<Field>
									<FieldLabel htmlFor={`${id}-uri`}>Setup address</FieldLabel>
									<Input id={`${id}-uri`} readOnly value={uri} />
								</Field>
								<Field>
									<FieldLabel>Backup codes</FieldLabel>
									<p className="text-sm">Save these backup codes.</p>
									<ul className="font-mono text-sm">
										{backupCodes.map((item) => (
											<li key={item}>{item}</li>
										))}
									</ul>
								</Field>
								<Field data-invalid={error ? true : undefined}>
									<FieldLabel htmlFor={`${id}-code`}>Code</FieldLabel>
									<Input
										id={`${id}-code`}
										value={code}
										onChange={(event) => setCode(event.target.value)}
									/>
									{error ? <FieldError>{error}</FieldError> : null}
								</Field>
								<DialogFooter>
									<Button
										type="button"
										disabled={code.trim() === "" || pending}
										onClick={() => void confirm()}
									>
										Confirm code
									</Button>
								</DialogFooter>
							</>
						) : (
							<>
								<Field data-invalid={error ? true : undefined}>
									<FieldLabel htmlFor={`${id}-password`}>Password</FieldLabel>
									<Input
										id={`${id}-password`}
										type="password"
										autoComplete="current-password"
										value={password}
										onChange={(event) => setPassword(event.target.value)}
									/>
									{error ? <FieldError>{error}</FieldError> : null}
								</Field>
								<DialogFooter>
									<Button
										type="button"
										disabled={password === "" || pending}
										onClick={() => void enable()}
									>
										Continue
									</Button>
								</DialogFooter>
							</>
						)}
					</FieldGroup>
				)}
			</DialogContent>
		</Dialog>
	);
}
