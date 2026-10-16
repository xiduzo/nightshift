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
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
} from "@nightshift/ui/components/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PencilIcon, PlugZapIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { orpc } from "@/utils/orpc";

import {
	type Fact,
	FactList,
	initials,
	KindBadge,
	MonoTile,
	OffMachineNote,
	VariableBadge,
} from "./parts";
import { McpTestOutcome } from "./test-result";
import type { Connection } from "./types";

function host(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

/** The command line as one string, quoting the arguments that need it. */
function commandLine(command: string, args: string[]): string {
	return [command, ...args]
		.map((part) => (/[\s"']/.test(part) ? JSON.stringify(part) : part))
		.join(" ");
}

/** One MCP server defined on this daemon. */
export function ConnectionCard({
	connection,
	onEdit,
}: {
	connection: Connection;
	onEdit: () => void;
}) {
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState(false);
	const test = useMutation(orpc.connections.test.mutationOptions());
	const remove = useMutation(
		orpc.connections.remove.mutationOptions({
			onSuccess: () => {
				toast.success(`Removed ${connection.name}`);
				setRemoving(false);
				void queryClient.invalidateQueries({
					queryKey: orpc.connections.list.key(),
				});
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);

	const server = connection.server;
	const remote = "url" in server ? server : null;
	const local = "command" in server ? server : null;
	const line = local ? commandLine(local.command, local.args) : "";

	const facts: Fact[] = [];
	if (local) {
		facts.push({
			label: "Command",
			value: (
				<Tooltip>
					<TooltipTrigger
						render={
							<span className="block truncate font-mono text-xs leading-5" />
						}
					>
						{line}
					</TooltipTrigger>
					<TooltipContent className="max-w-sm break-all font-mono">
						{line}
					</TooltipContent>
				</Tooltip>
			),
		});
	}
	if (remote) {
		facts.push({
			label: "URL",
			value: <span className="font-mono text-xs leading-5">{remote.url}</span>,
		});
	}
	facts.push({
		label: "Secrets",
		value:
			connection.variables.length > 0 ? (
				<ul className="flex flex-wrap gap-1.5">
					{connection.variables.map((variable) => (
						<li key={variable.name} className="max-w-full">
							<VariableBadge name={variable.name} source={variable.source} />
						</li>
					))}
				</ul>
			) : (
				<span className="text-muted-foreground">None</span>
			),
	});
	facts.push({
		label: "Used by",
		value:
			connection.usedBy.length > 0 ? (
				<ul className="flex flex-col gap-1">
					{connection.usedBy.map((use) => (
						<li key={`${use.projectId}/${use.flowName}`} className="truncate">
							<Link
								to="/projects/$projectId/flows/$name"
								params={{ projectId: use.projectId, name: use.flowName }}
								className="underline-offset-3 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
							>
								<span className="text-muted-foreground">
									{use.projectName} /{" "}
								</span>
								<span className="font-mono">{use.flowName}</span>
							</Link>
						</li>
					))}
				</ul>
			) : (
				<span className="text-muted-foreground">No flow uses it yet</span>
			),
	});

	return (
		<Card className="gap-4">
			<CardHeader>
				<Item className="flex-nowrap items-start p-0">
					<ItemMedia>
						<MonoTile>{initials(connection.name)}</MonoTile>
					</ItemMedia>
					<ItemContent className="min-w-0">
						<ItemTitle className="max-w-full truncate font-mono text-base">
							{connection.name}
						</ItemTitle>
						<ItemDescription className="line-clamp-none">
							{connection.description ?? (
								<span className="italic">No description</span>
							)}
						</ItemDescription>
					</ItemContent>
					<ItemActions>
						<KindBadge kind={remote ? "url" : "command"} />
					</ItemActions>
				</Item>
			</CardHeader>
			<CardContent className="flex-1 gap-4">
				<FactList facts={facts} />
				{remote ? (
					<OffMachineNote>
						Tool calls and their arguments go to{" "}
						<span className="font-mono">{host(remote.url)}</span>.
					</OffMachineNote>
				) : null}
				{test.isPending || test.data || test.error ? (
					<McpTestOutcome
						pending={test.isPending}
						result={test.data}
						error={test.error}
					/>
				) : null}
			</CardContent>
			<CardFooter className="flex-wrap gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={test.isPending}
					onClick={() => test.mutate({ name: connection.name })}
				>
					{test.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<PlugZapIcon data-icon="inline-start" />
					)}
					{test.isPending ? "Testing…" : test.data ? "Test again" : "Test"}
				</Button>
				<Button variant="ghost" size="sm" onClick={onEdit}>
					<PencilIcon data-icon="inline-start" />
					Edit
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto text-muted-foreground hover:text-destructive"
					onClick={() => setRemoving(true)}
				>
					<Trash2Icon data-icon="inline-start" />
					Remove
				</Button>
			</CardFooter>

			<AlertDialog open={removing} onOpenChange={setRemoving}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove <span className="font-mono">{connection.name}</span>?
						</AlertDialogTitle>
						<AlertDialogDescription>
							{connection.usedBy.length > 0 ? (
								<>
									{connection.usedBy.length === 1
										? "One flow names it: "
										: `${connection.usedBy.length} flows name it: `}
									<span className="font-mono">
										{connection.usedBy.map((use) => use.flowName).join(", ")}
									</span>
									. They will refuse to start until the name is removed from
									their Agent nodes.
								</>
							) : (
								"No flow names it. Secrets it uses stay where they are."
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => remove.mutate({ name: connection.name })}
						>
							{remove.isPending ? <Spinner data-icon="inline-start" /> : null}
							{remove.isPending ? "Removing…" : "Remove connection"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}
