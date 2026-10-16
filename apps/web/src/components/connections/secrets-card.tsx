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
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
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
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	CircleAlertIcon,
	KeyRoundIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import type { SecretView } from "./types";

const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** Where a secret's value lives: the keychain, the environment, both, or nowhere. */
function WhereBadges({ secret }: { secret: SecretView }) {
	if (!secret.saved && !secret.inEnv) {
		return (
			<Tooltip>
				<TooltipTrigger render={<span className="inline-flex" />}>
					<Badge
						variant="outline"
						className="border-status-waiting/40 bg-status-waiting/10 text-status-waiting"
					>
						Missing
					</Badge>
				</TooltipTrigger>
				<TooltipContent className="max-w-64">
					Set it here, or set it where the daemon starts.
				</TooltipContent>
			</Tooltip>
		);
	}
	return (
		<span className="flex flex-wrap gap-1.5">
			{secret.saved ? (
				<Badge
					variant="outline"
					className="border-status-finished/40 bg-status-finished/10 text-status-finished"
				>
					Keychain
				</Badge>
			) : null}
			{secret.inEnv ? <Badge variant="secondary">Environment</Badge> : null}
		</span>
	);
}

/** The `${NAME}` values connections read: saved in the keychain, or from the environment. */
export function SecretsCard({ secrets }: { secrets: SecretView[] }) {
	/** The secret being set; "" adds a new one. */
	const [setting, setSetting] = useState<string | null>(null);
	const [removing, setRemoving] = useState<string | null>(null);

	return (
		<Card className="gap-0 py-0">
			<CardHeader className="border-b py-4 [.border-b]:pb-4">
				<CardTitle>
					<h2 id="secrets-heading">Secrets</h2>
				</CardTitle>
				<CardDescription>
					The values behind <span className="font-mono">${"{NAME}"}</span>. A
					saved value lives in the macOS keychain and wins over the daemon's
					environment. Night Shift never shows one again.
				</CardDescription>
				<CardAction>
					<Button variant="outline" size="sm" onClick={() => setSetting("")}>
						<PlusIcon data-icon="inline-start" />
						Add secret
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="px-0">
				{secrets.length === 0 ? (
					<Empty className="py-8">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<KeyRoundIcon />
							</EmptyMedia>
							<EmptyTitle>No secrets yet</EmptyTitle>
							<EmptyDescription>
								A secret shows up here once a connection names it as{" "}
								<span className="font-mono">${"{NAME}"}</span>, or when you add
								one.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					<Table aria-labelledby="secrets-heading">
						<TableHeader>
							<TableRow>
								<TableHead className="pl-4 md:pl-6">Name</TableHead>
								<TableHead>Where</TableHead>
								<TableHead>Used by</TableHead>
								<TableHead className="pr-4 text-right md:pr-6">
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{secrets.map((secret) => (
								<TableRow key={secret.name}>
									<TableCell className="pl-4 font-mono md:pl-6">
										{secret.name}
									</TableCell>
									<TableCell>
										<WhereBadges secret={secret} />
									</TableCell>
									<TableCell className="font-mono text-muted-foreground">
										{secret.usedBy.length > 0 ? secret.usedBy.join(", ") : "—"}
									</TableCell>
									<TableCell className="pr-4 md:pr-6">
										<div className="flex justify-end gap-1">
											<Button
												variant="outline"
												size="sm"
												onClick={() => setSetting(secret.name)}
											>
												<KeyRoundIcon data-icon="inline-start" />
												Set
											</Button>
											{secret.saved ? (
												<Tooltip>
													<TooltipTrigger
														render={
															<Button
																variant="ghost"
																size="icon-sm"
																aria-label={`Remove ${secret.name} from the keychain`}
																className="text-muted-foreground hover:text-destructive"
																onClick={() => setRemoving(secret.name)}
															/>
														}
													>
														<Trash2Icon />
													</TooltipTrigger>
													<TooltipContent>Remove from keychain</TooltipContent>
												</Tooltip>
											) : null}
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
			</CardContent>

			<SecretDialog
				name={setting}
				secret={secrets.find((s) => s.name === setting) ?? null}
				onOpenChange={(open) => {
					if (!open) setSetting(null);
				}}
			/>
			<RemoveSecretDialog
				name={removing}
				secret={secrets.find((s) => s.name === removing) ?? null}
				onOpenChange={(open) => {
					if (!open) setRemoving(null);
				}}
			/>
		</Card>
	);
}

/**
 * Saves a value in the macOS keychain. `name` "" asks for the name too; null
 * is closed.
 */
function SecretDialog({
	name,
	secret,
	onOpenChange,
}: {
	name: string | null;
	secret: SecretView | null;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={name !== null} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{name !== null ? (
					<SecretForm
						fixedName={name || null}
						secret={secret}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function SecretForm({
	fixedName,
	secret,
	onDone,
}: {
	fixedName: string | null;
	secret: SecretView | null;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [name, setName] = useState(fixedName ?? "");
	const [value, setValue] = useState("");
	const setSecret = useMutation(
		orpc.connections.setSecret.mutationOptions({
			onSuccess: () => {
				toast.success(`Saved ${name} in the keychain`);
				void queryClient.invalidateQueries({
					queryKey: orpc.connections.list.key(),
				});
				onDone();
			},
		}),
	);
	const trimmedName = name.trim();
	const nameInvalid = trimmedName !== "" && !SECRET_NAME.test(trimmedName);
	const canSave = SECRET_NAME.test(trimmedName) && value !== "";

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canSave) return;
				setSecret.mutate({ name: trimmedName, value });
			}}
		>
			<DialogHeader>
				<DialogTitle>
					{fixedName ? (
						<>
							Set <span className="font-mono">{fixedName}</span>
						</>
					) : (
						"Add secret"
					)}
				</DialogTitle>
				<DialogDescription>
					Saved in the macOS keychain under the service{" "}
					<span className="font-mono">nightshift</span>. Night Shift reads it
					when a connection starts and never shows it again.
					{secret?.inEnv
						? " It takes the place of the value in the daemon's environment."
						: null}
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="gap-5">
				{fixedName ? null : (
					<Field data-invalid={nameInvalid || undefined}>
						<FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
						<Input
							id={`${id}-name`}
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="GITHUB_TOKEN"
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							autoFocus
							aria-invalid={nameInvalid || undefined}
						/>
						{nameInvalid ? (
							<FieldError>
								Use letters, digits and _, starting with a letter or _.
							</FieldError>
						) : (
							<FieldDescription>
								Connections read it as{" "}
								<span className="font-mono">
									${"{"}
									{trimmedName || "NAME"}
									{"}"}
								</span>
								.
							</FieldDescription>
						)}
					</Field>
				)}
				<Field>
					<FieldLabel htmlFor={`${id}-value`}>Value</FieldLabel>
					<Input
						id={`${id}-value`}
						type="password"
						value={value}
						onChange={(event) => setValue(event.target.value)}
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						autoFocus={Boolean(fixedName)}
					/>
					<FieldDescription>
						{secret?.saved
							? "A new value replaces the saved one."
							: "Paste it once. To change it later, set it again."}
					</FieldDescription>
				</Field>
				{setSecret.error ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>Not saved</AlertTitle>
						<AlertDescription>{setSecret.error.message}</AlertDescription>
					</Alert>
				) : null}
			</FieldGroup>
			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={!canSave || setSecret.isPending}>
					{setSecret.isPending ? <Spinner data-icon="inline-start" /> : null}
					{setSecret.isPending ? "Saving…" : "Save in keychain"}
				</Button>
			</DialogFooter>
		</form>
	);
}

function RemoveSecretDialog({
	name,
	secret,
	onOpenChange,
}: {
	name: string | null;
	secret: SecretView | null;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const removeSecret = useMutation(
		orpc.connections.removeSecret.mutationOptions({
			onSuccess: () => {
				toast.success(`Removed ${name} from the keychain`);
				void queryClient.invalidateQueries({
					queryKey: orpc.connections.list.key(),
				});
				onOpenChange(false);
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);
	const usedBy = secret?.usedBy ?? [];

	return (
		<AlertDialog open={name !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Remove <span className="font-mono">{name}</span> from the keychain?
					</AlertDialogTitle>
					<AlertDialogDescription>
						{usedBy.length === 0
							? "No connection names it."
							: secret?.inEnv
								? `${usedBy.join(", ")} will read it from the daemon's environment instead.`
								: `${usedBy.join(", ")} will have no value for it, and Agent nodes that name ${usedBy.length === 1 ? "that connection" : "those connections"} will fail to start.`}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={removeSecret.isPending}
						onClick={() => {
							if (name) removeSecret.mutate({ name });
						}}
					>
						{removeSecret.isPending ? (
							<Spinner data-icon="inline-start" />
						) : null}
						{removeSecret.isPending ? "Removing…" : "Remove from keychain"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
