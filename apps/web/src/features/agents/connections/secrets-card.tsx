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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
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
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ArrowRightLeftIcon,
	CircleAlertIcon,
	FolderInputIcon,
	KeyRoundIcon,
	MoreHorizontalIcon,
	PlusIcon,
	Trash2Icon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { SecretView } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { useNow } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { connectionMutations, connectionQueries } from "../queries";
import { MoveToProjectDialog } from "./move-to-project-dialog";
import { OUTSIDE_HINT } from "./parts";
import {
	Ago,
	SCOPE,
	SECRET_NAME,
	type SecretScope,
	UsedBy,
} from "./secret-parts";

/** One row of the list: a name in one scope. */
type SecretRef = { name: string; scope: SecretScope };

const rowId = (secret: SecretRef) => `${secret.scope}:${secret.name}`;

/** Where a secret's value lives: Personal, this computer, the environment, or nowhere. */
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
					No value yet. Choose Set value in the menu of this row.
				</TooltipContent>
			</Tooltip>
		);
	}
	const scope = SCOPE[secret.scope];
	return (
		<span className="flex flex-wrap gap-1.5">
			{secret.saved ? (
				<Tooltip>
					<TooltipTrigger render={<span className="inline-flex" />}>
						<Badge
							variant="outline"
							className="border-status-finished/40 bg-status-finished/10 text-status-finished"
						>
							<scope.icon data-icon="inline-start" aria-hidden />
							{scope.label}
						</Badge>
					</TooltipTrigger>
					<TooltipContent className="max-w-64">{scope.hint}</TooltipContent>
				</Tooltip>
			) : null}
			{secret.inEnv ? (
				<Tooltip>
					<TooltipTrigger render={<span className="inline-flex" />}>
						<Badge variant="secondary">Outside Night Shift</Badge>
					</TooltipTrigger>
					<TooltipContent className="max-w-64">{OUTSIDE_HINT}</TooltipContent>
				</Tooltip>
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
	personal,
	onSet,
	onMove,
	onMoveToProject,
	onRemove,
}: {
	now: number;
	/** The Personal secrets can be read now: a move to Personal can work. */
	personal: boolean;
	onSet: (secret: SecretRef) => void;
	onMove: (secret: SecretRef) => void;
	onMoveToProject: (secret: SecretRef) => void;
	onRemove: (secret: SecretRef) => void;
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
			cell: ({ row }) => <UsedBy users={usersOf(row.original)} />,
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
			cell: ({ row: { original: secret } }) => {
				const ref = { name: secret.name, scope: secret.scope };
				return (
					<div className="flex justify-end">
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={`More for ${secret.name}`}
									/>
								}
							>
								<MoreHorizontalIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-52">
								<DropdownMenuItem onClick={() => onSet(ref)}>
									<KeyRoundIcon />
									{secret.saved ? "Change value" : "Set value"}
								</DropdownMenuItem>
								{secret.saved ? (
									<DropdownMenuItem
										disabled={secret.scope === "computer" && !personal}
										onClick={() => onMove(ref)}
									>
										<ArrowRightLeftIcon />
										{secret.scope === "computer"
											? "Move to Personal"
											: "Move to this computer"}
									</DropdownMenuItem>
								) : null}
								{secret.saved ? (
									<DropdownMenuItem onClick={() => onMoveToProject(ref)}>
										<FolderInputIcon />
										Move to a project…
									</DropdownMenuItem>
								) : null}
								{secret.saved ? (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											variant="destructive"
											onClick={() => onRemove(ref)}
										>
											<Trash2Icon />
											Remove saved value
										</DropdownMenuItem>
									</>
								) : null}
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				);
			},
			meta: {
				headClassName: "pr-4 text-right md:pr-6",
				cellClassName: "pr-4 md:pr-6",
			},
		}),
	]);
}

/**
 * The `${NAME}` values connections and Command nodes read: Personal ones,
 * for the person's steps on all their computers, and this computer's own.
 */
export function SecretsCard({
	secrets,
	personal,
}: {
	secrets: SecretView[];
	/** Whether the Personal secrets could be read now. */
	personal: "available" | "unavailable";
}) {
	/** The secret being set; `{ name: "" }` adds a new one. */
	const [setting, setSetting] = useState<SecretRef | null>(null);
	const [removing, setRemoving] = useState<SecretRef | null>(null);
	const [toProject, setToProject] = useState<SecretRef | null>(null);
	const now = useNow(60_000);
	const queryClient = useQueryClient();
	const moveSecret = useMutation(
		connectionMutations.moveSecret({
			onSuccess: (_, { name, to }) => {
				toast.success(`Moved ${name} to ${SCOPE[to].label}`);
				void queryClient.invalidateQueries({
					queryKey: connectionQueries.lists(),
				});
			},
			onError: (error) => toast.error(`Not moved: ${error.message}`),
		}),
	);
	const find = (ref: SecretRef | null) =>
		ref === null
			? null
			: (secrets.find((s) => rowId(s) === rowId(ref)) ?? null);

	return (
		<PageSection
			title="Your secrets"
			description={
				<>
					Tokens and passwords your tools and commands use, written as{" "}
					<span className="font-mono">${"{NAME}"}</span>. Night Shift keeps them
					safe and never shows them again.
				</>
			}
			actions={
				<Button
					variant="outline"
					size="sm"
					onClick={() => setSetting({ name: "", scope: "computer" })}
				>
					<PlusIcon data-icon="inline-start" />
					Add secret
				</Button>
			}
		>
			{personal === "unavailable" ? (
				<Alert>
					<CircleAlertIcon />
					<AlertTitle>Your Personal secrets are not shown</AlertTitle>
					<AlertDescription>
						Night Shift could not read them now. Check that this computer is
						online, then try again.
					</AlertDescription>
				</Alert>
			) : null}
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
									<span className="font-mono">${"{NAME}"}</span> in the settings
									of a tool. It then shows here.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<DataTable
							aria-label="Secrets"
							columns={secretColumns({
								now,
								personal: personal === "available",
								onSet: setSetting,
								onMove: (ref) =>
									moveSecret.mutate({
										name: ref.name,
										to: ref.scope === "computer" ? "personal" : "computer",
									}),
								onMoveToProject: setToProject,
								onRemove: setRemoving,
							})}
							data={secrets}
							getRowId={rowId}
						/>
					)}
				</CardContent>

				<SecretDialog
					target={setting}
					secret={find(setting)}
					personal={personal === "available"}
					onOpenChange={(open) => {
						if (!open) setSetting(null);
					}}
				/>
				<RemoveSecretDialog
					target={removing}
					secret={find(removing)}
					onOpenChange={(open) => {
						if (!open) setRemoving(null);
					}}
				/>
				<MoveToProjectDialog
					target={
						toProject === null
							? null
							: { name: toProject.name, from: { scope: toProject.scope } }
					}
					onOpenChange={(open) => {
						if (!open) setToProject(null);
					}}
				/>
			</Card>
		</PageSection>
	);
}

/**
 * Saves a value, as Personal or for this computer. A `target` with no name
 * asks for the name too; null is closed.
 */
function SecretDialog({
	target,
	secret,
	personal,
	onOpenChange,
}: {
	target: SecretRef | null;
	secret: SecretView | null;
	/** Personal can be chosen now. */
	personal: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={target !== null} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{target !== null ? (
					<SecretForm
						fixedName={target.name || null}
						initialScope={target.scope}
						secret={secret}
						personal={personal}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** Where a new value goes: Personal or this computer. */
function ScopeChoice({
	value,
	personal,
	onChange,
}: {
	value: SecretScope;
	personal: boolean;
	onChange: (scope: SecretScope) => void;
}) {
	const id = useId();
	return (
		<FieldSet>
			<FieldLegend variant="label">Who can use it</FieldLegend>
			<RadioGroup
				value={value}
				onValueChange={(next) => onChange(next as SecretScope)}
			>
				{(["personal", "computer"] as const).map((scope) => {
					const { label, hint } = SCOPE[scope];
					const disabled = scope === "personal" && !personal;
					return (
						<FieldLabel key={scope} htmlFor={`${id}-${scope}`}>
							<Field
								orientation="horizontal"
								data-disabled={disabled || undefined}
							>
								<FieldContent>
									<FieldTitle>{label}</FieldTitle>
									<FieldDescription>
										{disabled
											? "Not available now. Check that this computer is online."
											: hint}
									</FieldDescription>
								</FieldContent>
								<RadioGroupItem
									value={scope}
									id={`${id}-${scope}`}
									disabled={disabled}
								/>
							</Field>
						</FieldLabel>
					);
				})}
			</RadioGroup>
		</FieldSet>
	);
}

function SecretForm({
	fixedName,
	initialScope,
	secret,
	personal,
	onDone,
}: {
	fixedName: string | null;
	initialScope: SecretScope;
	secret: SecretView | null;
	personal: boolean;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [name, setName] = useState(fixedName ?? "");
	const [value, setValue] = useState("");
	const [scope, setScope] = useState<SecretScope>(initialScope);
	const setSecret = useMutation(
		connectionMutations.setSecret({
			onSuccess: () => {
				toast.success(`Saved ${name}`);
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
	// A saved value keeps its place. A new one, or one without a value, chooses.
	const chooses = !secret?.saved;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canSave) return;
				setSecret.mutate({ name: trimmedName, value, scope });
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
					Night Shift keeps it safe and never shows it again.
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
								Start with a letter or _. Use letters, digits and _.
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
				{chooses ? (
					<ScopeChoice value={scope} personal={personal} onChange={setScope} />
				) : null}
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
					{setSecret.isPending ? "Saving…" : "Save"}
				</Button>
			</DialogFooter>
		</form>
	);
}

function RemoveSecretDialog({
	target,
	secret,
	onOpenChange,
}: {
	target: SecretRef | null;
	secret: SecretView | null;
	onOpenChange: (open: boolean) => void;
}) {
	const queryClient = useQueryClient();
	const removeSecret = useMutation(
		connectionMutations.removeSecret({
			onSuccess: () => {
				toast.success(`Removed ${target?.name}`);
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
		<AlertDialog open={target !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{target?.scope === "personal" ? (
							<>
								Remove the Personal secret{" "}
								<span className="font-mono">{target.name}</span>?
							</>
						) : (
							<>
								Remove <span className="font-mono">{target?.name}</span> from
								this computer?
							</>
						)}
					</AlertDialogTitle>
					<AlertDialogDescription>{consequence}</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={removeSecret.isPending}
						onClick={() => {
							if (target) removeSecret.mutate(target);
						}}
					>
						{removeSecret.isPending ? (
							<Spinner data-icon="inline-start" />
						) : null}
						{removeSecret.isPending ? "Removing…" : "Remove"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
