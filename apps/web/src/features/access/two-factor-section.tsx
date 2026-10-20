import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
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
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRoundIcon, ShieldCheckIcon, ShieldIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { authClient } from "@/shared/api";
import { BackupCodes } from "./backup-codes";
import { authErrorMessage } from "./two-factor";
import { TwoFactorSetup } from "./two-factor-setup";

/** How the session's Person signs in (`account.status`). */
export type SignInStatus = {
	thisComputer: boolean;
	hasPassword: boolean;
	twoFactor: { enabled: boolean; required: boolean };
};

/**
 * Two-factor sign-in on the account page: its state, and turning it on,
 * off, and making new backup codes. A Person without a password has
 * nothing to protect yet: the page says how to set one.
 */
export function TwoFactorSection({
	status,
	email,
}: {
	status: SignInStatus;
	email: string;
}) {
	const queryClient = useQueryClient();
	const [dialog, setDialog] = useState<"on" | "off" | "codes" | null>(null);
	const close = () => setDialog(null);
	/** The session changed: the account and every page read it again. */
	const refresh = async () => {
		await authClient.getSession({ query: { disableCookieCache: true } });
		await queryClient.invalidateQueries();
	};

	if (!status.hasPassword) {
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<KeyRoundIcon />
					</EmptyMedia>
					<EmptyTitle>Set a password first</EmptyTitle>
					<EmptyDescription>
						Night Shift signs you in on this computer for you. To sign in from
						another computer, run this command on this computer. Then turn on
						two-factor sign-in.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">
						nightshift admin --email you@example.com
					</code>
				</EmptyContent>
			</Empty>
		);
	}

	const { enabled, required } = status.twoFactor;
	return (
		<Card>
			<CardContent>
				<Item size="sm" className="px-0">
					<ItemMedia variant="icon">
						{enabled ? (
							<ShieldCheckIcon aria-hidden="true" />
						) : (
							<ShieldIcon aria-hidden="true" />
						)}
					</ItemMedia>
					<ItemContent className="min-w-0">
						<ItemTitle>
							Two-factor sign-in
							<Badge variant={enabled ? "secondary" : "outline"}>
								{enabled ? "On" : "Off"}
							</Badge>
						</ItemTitle>
						<ItemDescription className="line-clamp-none">
							{enabled
								? "After your password, you enter a code from your authenticator app."
								: "Add a code from an authenticator app to your password. Your password alone then cannot sign you in."}
						</ItemDescription>
					</ItemContent>
					<ItemActions>
						{enabled ? (
							<>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setDialog("codes")}
								>
									New backup codes
								</Button>
								<Button
									variant="outline"
									size="sm"
									onClick={() => setDialog("off")}
								>
									Turn off
								</Button>
							</>
						) : (
							<Button size="sm" onClick={() => setDialog("on")}>
								Turn on
							</Button>
						)}
					</ItemActions>
				</Item>
			</CardContent>

			<Dialog
				open={dialog === "on"}
				onOpenChange={(open) => (open ? null : close())}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Turn on two-factor sign-in</DialogTitle>
						<DialogDescription>
							You need an authenticator app on your phone or computer.
						</DialogDescription>
					</DialogHeader>
					{dialog === "on" ? (
						<TwoFactorSetup
							email={email}
							onDone={async () => {
								close();
								toast.success("Two-factor sign-in is on");
								await refresh();
							}}
						/>
					) : null}
				</DialogContent>
			</Dialog>

			<Dialog
				open={dialog === "codes"}
				onOpenChange={(open) => (open ? null : close())}
			>
				<DialogContent className="sm:max-w-md">
					{dialog === "codes" ? <NewBackupCodes email={email} /> : null}
				</DialogContent>
			</Dialog>

			<Dialog
				open={dialog === "off"}
				onOpenChange={(open) => (open ? null : close())}
			>
				<DialogContent className="sm:max-w-md">
					{dialog === "off" ? (
						<TurnOff
							required={required}
							onDone={async () => {
								close();
								toast.success("Two-factor sign-in is off");
								await refresh();
							}}
						/>
					) : null}
				</DialogContent>
			</Dialog>
		</Card>
	);
}

/** The password, then a new set of backup codes. The old ones stop working. */
function NewBackupCodes({ email }: { email: string }) {
	const id = useId();
	const [password, setPassword] = useState("");
	const [codes, setCodes] = useState<string[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function submit() {
		setPending(true);
		setError(null);
		const result = await authClient.twoFactor.generateBackupCodes({ password });
		setPending(false);
		if (result.error || !result.data) {
			setError(authErrorMessage(result.error));
			return;
		}
		setCodes(result.data.backupCodes);
	}

	if (codes) {
		return (
			<>
				<DialogHeader>
					<DialogTitle>Save your new backup codes</DialogTitle>
					<DialogDescription>
						Your old backup codes no longer work. You see these only now.
					</DialogDescription>
				</DialogHeader>
				<BackupCodes codes={codes} email={email} />
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
				if (password && !pending) void submit();
			}}
		>
			<DialogHeader>
				<DialogTitle>Make new backup codes</DialogTitle>
				<DialogDescription>
					Your old backup codes stop working. Use this when you lost them or
					used most of them.
				</DialogDescription>
			</DialogHeader>
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
					{error ? <FieldError>{error}</FieldError> : null}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="outline" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={!password || pending}>
					{pending ? <Spinner data-icon="inline-start" /> : null}
					Make new codes
				</Button>
			</DialogFooter>
		</form>
	);
}

/** The password, then two-factor sign-in is off and its backup codes are gone. */
function TurnOff({
	required,
	onDone,
}: {
	required: boolean;
	onDone: () => Promise<void>;
}) {
	const id = useId();
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function submit() {
		setPending(true);
		setError(null);
		const result = await authClient.twoFactor.disable({ password });
		if (result.error) {
			setPending(false);
			setError(authErrorMessage(result.error));
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
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (password && !pending) void submit();
			}}
		>
			<DialogHeader>
				<DialogTitle>Turn off two-factor sign-in?</DialogTitle>
				<DialogDescription>
					Your password alone then signs you in. Your backup codes stop working.
				</DialogDescription>
			</DialogHeader>
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
					{required ? (
						<FieldDescription>
							This Host asks for two-factor sign-in. You must turn it on again
							before you can continue.
						</FieldDescription>
					) : null}
					{error ? <FieldError>{error}</FieldError> : null}
				</Field>
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="outline" />}>
					Cancel
				</DialogClose>
				<Button
					type="submit"
					variant="destructive"
					disabled={!password || pending}
				>
					{pending ? <Spinner data-icon="inline-start" /> : null}
					Turn off
				</Button>
			</DialogFooter>
		</form>
	);
}
