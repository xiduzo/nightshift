/** The columns of the secrets table of this computer: where a value lives, what uses it, when it was saved, and the menu of a row. */
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import {
	ArrowRightLeftIcon,
	FolderInputIcon,
	KeyRoundIcon,
	MoreHorizontalIcon,
	Trash2Icon,
} from "lucide-react";
import type { SecretView } from "@/shared/api";
import { dataTableColumns } from "@/shared/data-table";
import { OUTSIDE_HINT } from "../connections";
import { Ago, SCOPE, type SecretScope, UsedBy } from "./secret-parts";

/** One row of the list: a name in one scope. */
export type SecretRef = { name: string; scope: SecretScope };

export const rowId = (secret: SecretRef) => `${secret.scope}:${secret.name}`;

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

/** The flows that use the secret, each once. */
export function flowNamesOf(secret: SecretView): string[] {
	return [...new Set(secret.flows.map((flow) => flow.flowName))];
}

/** The flows a webhook schedule with the secret starts, each once. */
export function webhookFlowsOf(secret: SecretView): string[] {
	return [...new Set(secret.webhooks.map((flow) => flow.flowName))];
}

/** What uses the secret: its connections and CLI tools, then its flows and webhooks. */
export function usersOf(secret: SecretView): string[] {
	return [
		...secret.usedBy,
		...secret.tools,
		...flowNamesOf(secret).map((name) => `${name} (flow)`),
		...webhookFlowsOf(secret).map((name) => `${name} (webhook)`),
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

export function secretColumns({
	now,
	personal,
	onSet,
	onMove,
	onMoveToProject,
	onMoveToSpace,
	onRemove,
}: {
	now: number;
	/** The Personal secrets can be read now: a move to Personal can work. */
	personal: boolean;
	onSet: (secret: SecretRef) => void;
	onMove: (secret: SecretRef) => void;
	onMoveToProject: (secret: SecretRef) => void;
	onMoveToSpace: (secret: SecretRef) => void;
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
									<DropdownMenuItem onClick={() => onMoveToSpace(ref)}>
										<FolderInputIcon />
										Move to this Space
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
