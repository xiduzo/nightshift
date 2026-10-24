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
import type { SecretView } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { formatDateTime, formatRelative, useNow } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { connectionMutations, connectionQueries } from "../queries";

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
					No value yet. Choose Set to save one.
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
			{secret.inEnv ? (
				<Badge variant="secondary">Outside Night Shift</Badge>
			) : null}
		</span>
	);
}

/** The flows whose Command nodes name the secret, each once. */
function flowNamesOf(secret: SecretView): string[] {
	return [...new Set(secret.flows.map((flow) => flow.flowName))];
}

/** What uses the secret: its connections and CLI tools, then its flows. */
function usersOf(secret: SecretView): string[] {
	return [
		...secret.usedBy,
		...secret.tools,
		...flowNamesOf(secret).map((name) => `${name} (flow)`),
	];
}

/** A moment as "3 minutes ago", with the date and time on hover. */
function Ago({ at, now }: { at: number; now: number }) {
	return (
		<Tooltip>
			<TooltipTrigger render={<time dateTime={new Date(at).toISOString()} />}>
				{formatRelative(at, now)}
			</TooltipTrigger>
			<TooltipContent>{formatDateTime(at)}</TooltipContent>
		</Tooltip>
	);
}

/** When a value was last saved: "—" when it is not saved here, or saved before the date was kept. */
function LastSet({ secret, now }: { secret: SecretView; now: number }) {
	if (secret.setAt !== null) return <Ago at={secret.setAt} now={now} />;
	const hint = secret.saved
		? "Saved earlier. The date is not known."
		: "Not set in Night Shift.";
	return (
		<Tooltip>
			<TooltipTrigger render={<span />}>
				<span aria-hidden>—</span>
				<span className="sr-only">{hint}</span>
			</TooltipTrigger>
			<TooltipContent>{hint}</TooltipContent>
		</Tooltip>
	);
}

const column = dataTableColumns<SecretView>();

function secretColumns({
	now,
	onSet,
	onRemove,
}: {
	now: number;
	onSet: (name: string) => void;
	onRemove: (name: string) => void;
}) {
	return column.columns([
		column.accessor("name", {
			header: "Name",
			meta: {
				headClassName: "pl-4 md:pl-6",
				cellClassName: "pl-4 font-mono md:pl-6",
			},
		}),
		column.display({
			id: "where",
			header: "Where",
			cell: ({ row }) => <WhereBadges secret={row.original} />,
		}),
		column.accessor("usedBy", {
			header: "Used by",
			cell: ({ row }) => {
				const users = usersOf(row.original);
				return users.length > 0 ? users.join(", ") : "—";
			},
			meta: { cellClassName: "font-mono text-muted-foreground" },
		}),
		column.accessor("setAt", {
			header: "Last set",
			cell: ({ row }) => <LastSet secret={row.original} now={now} />,
			meta: {
				headClassName: "hidden lg:table-cell",
				cellClassName:
					"hidden whitespace-nowrap text-muted-foreground lg:table-cell",
			},
		}),
		column.accessor("usedAt", {
			header: "Last used",
			cell: ({ row: { original } }) =>
				original.usedAt !== null ? (
					<Ago at={original.usedAt} now={now} />
				) : (
					"Never"
				),
			meta: {
				headClassName: "hidden md:table-cell",
				cellClassName:
					"hidden whitespace-nowrap text-muted-foreground md:table-cell",
			},
		}),
		column.display({
			id: "actions",
			header: () => <span className="sr-only">Actions</span>,
			cell: ({ row: { original: secret } }) => (
				<div className="flex justify-end gap-1">
					<Button
						variant="outline"
						size="sm"
						onClick={() => onSet(secret.name)}
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
										onClick={() => onRemove(secret.name)}
									/>
								}
							>
								<Trash2Icon />
							</TooltipTrigger>
							<TooltipContent>Remove from keychain</TooltipContent>
						</Tooltip>
					) : null}
				</div>
			),
			meta: {
				headClassName: "pr-4 text-right md:pr-6",
				cellClassName: "pr-4 md:pr-6",
			},
		}),
	]);
}

/** The `${NAME}` values connections and Command nodes read: saved in the keychain, or from the environment. */
export function SecretsCard({ secrets }: { secrets: SecretView[] }) {
	/** The secret being set; "" adds a new one. */
	const [setting, setSetting] = useState<string | null>(null);
	const [removing, setRemoving] = useState<string | null>(null);
	const now = useNow(60_000);

	return (
		<PageSection
			title="Secrets"
			description={
				<>
					Tokens and passwords your tools and commands use, written as{" "}
					<span className="font-mono">${"{NAME}"}</span>. Night Shift keeps them
					in your macOS keychain and never shows them again.
				</>
			}
			actions={
				<Button variant="outline" size="sm" onClick={() => setSetting("")}>
					<PlusIcon data-icon="inline-start" />
					Add secret
				</Button>
			}
		>
			<Card className="py-0">
				<CardContent className="px-0">
					{secrets.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<KeyRoundIcon />
								</EmptyMedia>
								<EmptyTitle>No secrets yet</EmptyTitle>
								<EmptyDescription>
									Add a secret, or write{" "}
									<span className="font-mono">${"{NAME}"}</span> in a tool's
									settings and it shows up here.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<DataTable
							aria-label="Secrets"
							columns={secretColumns({
								now,
								onSet: setSetting,
								onRemove: setRemoving,
							})}
							data={secrets}
							getRowId={(secret) => secret.name}
						/>
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
		</PageSection>
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
		connectionMutations.setSecret({
			onSuccess: () => {
				toast.success(`Saved ${name} in the keychain`);
				void queryClient.invalidateQueries({
					queryKey: connectionQueries.lists(),
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
					Night Shift keeps it in your macOS keychain and never shows it again.
					{secret?.inEnv
						? " It replaces the value that is set outside Night Shift."
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
								Tools use it as{" "}
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
		connectionMutations.removeSecret({
			onSuccess: () => {
				toast.success(`Removed ${name} from the keychain`);
				void queryClient.invalidateQueries({
					queryKey: connectionQueries.lists(),
				});
				onOpenChange(false);
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);
	const usedBy = secret ? [...secret.usedBy, ...secret.tools] : [];
	const flows = secret ? flowNamesOf(secret) : [];
	const users = secret ? usersOf(secret) : [];
	const consequence =
		users.length === 0
			? "Nothing uses it."
			: secret?.inEnv
				? `${users.join(", ")} will use the value that is set outside Night Shift instead.`
				: [
						usedBy.length > 0
							? `${usedBy.join(", ")} will have no value for it. Agent nodes that use ${usedBy.length === 1 ? "that tool" : "those tools"} cannot run until you set it again.`
							: null,
						flows.length > 0
							? `Flows that use it (${flows.join(", ")}) stop before the command runs until you set it again.`
							: null,
					]
						.filter(Boolean)
						.join(" ");

	return (
		<AlertDialog open={name !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Remove <span className="font-mono">{name}</span> from the keychain?
					</AlertDialogTitle>
					<AlertDialogDescription>{consequence}</AlertDialogDescription>
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
