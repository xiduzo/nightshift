import { useChanged } from "@nightshift/client";
import {
	Alert,
	AlertAction,
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
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import { Dialog, DialogContent } from "@nightshift/ui/components/dialog";
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
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	type QueryKey,
	type UseQueryOptions,
	useMutation,
	useQuery,
} from "@tanstack/react-query";
import {
	CircleAlertIcon,
	KeyRoundIcon,
	LaptopIcon,
	MoreHorizontalIcon,
	PlusIcon,
	Trash2Icon,
	UserIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { orpc, type ProjectSecretRow } from "@/shared/api";
import { DataTable, dataTableColumns } from "@/shared/data-table";
import { toastFailure } from "@/shared/failure";
import { useNow } from "@/shared/format";
import { PageSection } from "@/shared/page";
import type { SharedSecretActions } from "../queries";
import { SecretForm } from "./secret-form";
import { Ago, SCOPE, UsedBy } from "./secret-parts";

/** What a list of shared secrets says: for a project, or for the Space. */
export type SharedSecretWords = {
	/** The section's title. */
	title: string;
	/** Who the secrets belong to, in a title: "Acme", "this Space". */
	owner: string;
	/** What a person who can change the flows can do with it: they read it before they save one. */
	trust: string;
	notShown: string;
	emptyTitle: string;
	emptyCanChange: string;
	emptyCannotChange: string;
	nothingUses: string;
};

/** The list a person sees: from `projects.secrets` or `projects.spaceSecrets`. */
type SecretList = {
	secrets: ProjectSecretRow[];
	available: boolean;
	canChange: boolean;
};

const column = dataTableColumns<ProjectSecretRow>();

function projectSecretColumns({
	now,
	canChange,
	onSet,
	onMove,
	onRemove,
}: {
	now: number;
	/** The person's role saves flows: the row menu shows. */
	canChange: boolean;
	onSet: (name: string) => void;
	onMove: (name: string, to: "personal" | "computer") => void;
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
		column.accessor("flows", {
			header: "Used by",
			cell: ({ row: { original } }) => (
				<UsedBy
					users={[
						...original.tools,
						...original.flows,
						...original.webhooks.map((flow) => `${flow} (webhook)`),
					]}
				/>
			),
			meta: { cellClassName: "font-mono text-muted-foreground" },
		}),
		column.accessor("setAt", {
			header: "Last set",
			cell: ({ row: { original } }) => (
				<span>
					<Ago at={original.setAt} now={now} />
					{original.setBy ? ` by ${original.setBy.name}` : null}
				</span>
			),
			meta: {
				headClassName: "hidden md:table-cell",
				cellClassName:
					"hidden whitespace-nowrap text-muted-foreground md:table-cell",
			},
		}),
		...(canChange
			? [
					column.display({
						id: "actions",
						header: () => <span className="sr-only">Actions</span>,
						cell: ({ row: { original: secret } }) => (
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
										<DropdownMenuItem onClick={() => onSet(secret.name)}>
											<KeyRoundIcon />
											Change value
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => onMove(secret.name, "personal")}
										>
											<UserIcon />
											Move to Personal
										</DropdownMenuItem>
										<DropdownMenuItem
											onClick={() => onMove(secret.name, "computer")}
										>
											<LaptopIcon />
											Move to this computer
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											variant="destructive"
											onClick={() => onRemove(secret.name)}
										>
											<Trash2Icon />
											Remove
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						),
						meta: {
							headClassName: "pr-4 text-right md:pr-6",
							cellClassName: "pr-4 md:pr-6",
						},
					}),
				]
			: []),
	]);
}

/**
 * The secrets every step can use on any computer: a project's or the
 * Space's. Members see the names, who set each and when. A Member whose role
 * saves flows adds, changes, moves and removes them. Nobody sees a value again.
 */
export function SharedSecrets({
	query,
	actions,
	words,
}: {
	query: UseQueryOptions<SecretList, Error, SecretList, QueryKey>;
	actions: SharedSecretActions;
	words: SharedSecretWords;
}) {
	const list = useQuery(query);
	/** The secret whose value is set; "" adds a new one. */
	const [setting, setSetting] = useState<string | null>(null);
	const [removing, setRemoving] = useState<ProjectSecretRow | null>(null);
	const now = useNow(60_000);
	const changed = useChanged({ orpc });
	// The actions call the client: the live cache does not see them.
	const refresh = () => changed("secrets");
	const move = useMutation({
		mutationFn: actions.moveOut,
		onSuccess: (_, { name, to }) => {
			toast.success(`Moved ${name} to ${SCOPE[to].label}`);
			refresh();
		},
		onError: toastFailure("Not moved"),
	});

	if (list.error) {
		return (
			<Alert variant="destructive">
				<CircleAlertIcon />
				<AlertTitle>The secrets did not load</AlertTitle>
				<AlertDescription>{list.error.message}</AlertDescription>
				<AlertAction>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void list.refetch()}
					>
						Try again
					</Button>
				</AlertAction>
			</Alert>
		);
	}
	if (!list.data) return <Skeleton className="h-64 w-full rounded-xl" />;
	const { secrets, available, canChange } = list.data;

	return (
		<PageSection
			title={words.title}
			description={
				canChange
					? "Night Shift keeps them safe and never shows them again."
					: "Only Members who can change flows add or change them."
			}
			actions={
				canChange && available ? (
					<Button variant="outline" size="sm" onClick={() => setSetting("")}>
						<PlusIcon data-icon="inline-start" />
						Add secret
					</Button>
				) : null
			}
		>
			{available ? null : (
				<Alert>
					<CircleAlertIcon />
					<AlertTitle>{words.notShown}</AlertTitle>
					<AlertDescription>
						Night Shift could not reach the Host of this Space. Check that this
						computer is online, then try again.
					</AlertDescription>
				</Alert>
			)}
			<Card className="py-0">
				<CardContent className="px-0">
					{secrets.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<KeyRoundIcon />
								</EmptyMedia>
								<EmptyTitle>{words.emptyTitle}</EmptyTitle>
								<EmptyDescription>
									{canChange ? words.emptyCanChange : words.emptyCannotChange}
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<DataTable
							aria-label={words.title}
							columns={projectSecretColumns({
								now,
								canChange,
								onSet: setSetting,
								onMove: (name, to) => move.mutate({ name, to }),
								onRemove: (name) =>
									setRemoving(secrets.find((s) => s.name === name) ?? null),
							})}
							data={secrets}
							getRowId={(secret) => secret.name}
						/>
					)}
				</CardContent>
			</Card>
			<SharedSecretDialog
				actions={actions}
				words={words}
				name={setting}
				saved={secrets.some((s) => s.name === setting)}
				onDone={refresh}
				onOpenChange={(open) => {
					if (!open) setSetting(null);
				}}
			/>
			<RemoveSharedSecretDialog
				actions={actions}
				words={words}
				secret={removing}
				onDone={refresh}
				onOpenChange={(open) => {
					if (!open) setRemoving(null);
				}}
			/>
		</PageSection>
	);
}

/** Saves a value. `name` "" asks for the name too; null is closed. */
function SharedSecretDialog({
	actions,
	words,
	name,
	saved,
	onDone,
	onOpenChange,
}: {
	actions: SharedSecretActions;
	words: SharedSecretWords;
	name: string | null;
	/** It has a value now: the new one replaces it. */
	saved: boolean;
	onDone: () => void;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={name !== null} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{name !== null ? (
					<SecretForm
						fixedName={name || null}
						addTitle={`Add a secret to ${words.owner}`}
						description={words.trust}
						placeholder="DATABASE_URL"
						saved={saved}
						valueHint="Paste it once. Nobody sees it again."
						save={actions.set}
						onDone={() => {
							onDone();
							onOpenChange(false);
						}}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function RemoveSharedSecretDialog({
	actions,
	words,
	secret,
	onDone,
	onOpenChange,
}: {
	actions: SharedSecretActions;
	words: SharedSecretWords;
	secret: ProjectSecretRow | null;
	onDone: () => void;
	onOpenChange: (open: boolean) => void;
}) {
	const remove = useMutation({
		mutationFn: actions.remove,
		onSuccess: () => {
			toast.success(`Removed ${secret?.name}`);
			onDone();
			onOpenChange(false);
		},
		onError: toastFailure("Not removed"),
	});
	const flows = secret?.flows ?? [];
	const tools = secret?.tools ?? [];
	const webhooks = secret?.webhooks ?? [];

	return (
		<AlertDialog open={secret !== null} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Remove <span className="font-mono">{secret?.name}</span> from{" "}
						{words.owner}?
					</AlertDialogTitle>
					<AlertDialogDescription>
						{flows.length === 0 && tools.length === 0 && webhooks.length === 0
							? words.nothingUses
							: [
									tools.length > 0
										? `${tools.join(", ")} will not sign in with it.`
										: null,
									flows.length > 0
										? `Flows that use it (${flows.join(", ")}) stop at the step that needs it, unless the computer that runs them has a secret of that name.`
										: null,
									webhooks.length > 0
										? `Webhooks of ${webhooks.join(", ")} stop working until you set it again.`
										: null,
								]
									.filter(Boolean)
									.join(" ")}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						variant="destructive"
						disabled={remove.isPending}
						onClick={() => {
							if (secret) {
								remove.mutate({ name: secret.name });
							}
						}}
					>
						{remove.isPending ? <Spinner data-icon="inline-start" /> : null}
						{remove.isPending ? "Removing…" : "Remove"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
