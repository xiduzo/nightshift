import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent, CardHeader } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { CircleAlertIcon, PlugIcon, PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { ConnectionCard } from "@/components/connections/connection-card";
import { ConnectionDialog } from "@/components/connections/connection-dialog";
import { HarnessCard, TOOLS } from "@/components/connections/harness-card";
import { SecretsCard } from "@/components/connections/secrets-card";
import type { Connection } from "@/components/connections/types";
import { SiteHeader } from "@/components/site-header";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/connections")({
	// The checks run CLIs on the daemon; nothing to render on the server.
	ssr: false,
	component: ConnectionsComponent,
});

function ConnectionsComponent() {
	const settings = useQuery(orpc.settings.get.queryOptions());
	const list = useQuery(orpc.connections.list.queryOptions());
	/** The connection in the dialog: null adds one, undefined is closed. */
	const [editing, setEditing] = useState<Connection | null | undefined>(
		undefined,
	);
	const [dialogOpen, setDialogOpen] = useState(false);
	const openDialog = (connection: Connection | null) => {
		setEditing(connection);
		setDialogOpen(true);
	};
	const connections = list.data?.connections ?? [];

	return (
		<>
			<SiteHeader crumbs={[{ label: "Connections" }]} />
			<div className="flex flex-1 flex-col gap-10 p-4 md:p-6">
				<div className="mx-auto flex w-full max-w-5xl flex-col gap-1">
					<h1 className="font-semibold text-2xl tracking-tight">Connections</h1>
					<p className="max-w-2xl text-muted-foreground text-sm">
						What Night Shift talks to on this machine: the coding-agent CLIs,
						the GitHub CLI, and the MCP servers that Agent nodes name.
					</p>
				</div>

				<Section
					id="tools"
					title="Harnesses and tools"
					description="The CLIs Night Shift runs. Each uses its own login; Night Shift only reads their version and login state here."
				>
					<div className="grid gap-4 md:grid-cols-2">
						{TOOLS.map((tool) => (
							<HarnessCard
								key={tool.target}
								tool={tool}
								settings={settings.data}
							/>
						))}
					</div>
				</Section>

				<Section
					id="mcp"
					title="MCP servers"
					description="Tools for Agent nodes. Define a server once here, then pick it on an Agent node by name."
					action={
						<Button size="sm" onClick={() => openDialog(null)}>
							<PlusIcon data-icon="inline-start" />
							Add MCP server
						</Button>
					}
				>
					{list.isPending ? (
						<div className="grid gap-4 md:grid-cols-2">
							<ConnectionCardSkeleton />
							<ConnectionCardSkeleton />
						</div>
					) : list.error ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>The connections did not load</AlertTitle>
							<AlertDescription>{list.error.message}</AlertDescription>
							<AlertAction>
								<Button
									variant="outline"
									size="sm"
									disabled={list.isFetching}
									onClick={() => void list.refetch()}
								>
									{list.isFetching ? (
										<Spinner data-icon="inline-start" />
									) : null}
									Try again
								</Button>
							</AlertAction>
						</Alert>
					) : connections.length === 0 ? (
						<Empty className="border border-dashed">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<PlugIcon />
								</EmptyMedia>
								<EmptyTitle>No MCP servers yet</EmptyTitle>
								<EmptyDescription>
									Define a server once, then pick it on an Agent node. Secrets
									stay <span className="font-mono">${"{NAME}"}</span> and come
									from the keychain or the environment.
								</EmptyDescription>
							</EmptyHeader>
							<EmptyContent>
								<Button
									variant="outline"
									size="sm"
									onClick={() => openDialog(null)}
								>
									<PlusIcon data-icon="inline-start" />
									Add MCP server
								</Button>
							</EmptyContent>
						</Empty>
					) : (
						<div className="grid gap-4 md:grid-cols-2">
							{connections.map((connection) => (
								<ConnectionCard
									key={connection.name}
									connection={connection}
									onEdit={() => openDialog(connection)}
								/>
							))}
						</div>
					)}
				</Section>

				<div className="mx-auto w-full max-w-5xl">
					{list.data ? (
						<SecretsCard secrets={list.data.secrets} />
					) : list.isPending ? (
						<Skeleton className="h-40 w-full rounded-xl" />
					) : null}
				</div>
			</div>

			{editing !== undefined ? (
				<ConnectionDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					connection={editing}
					taken={connections.map((c) => c.name)}
				/>
			) : null}
		</>
	);
}

function Section({
	id,
	title,
	description,
	action,
	children,
}: {
	id: string;
	title: string;
	description: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="mx-auto flex w-full max-w-5xl flex-col gap-4"
		>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div className="flex flex-col gap-1">
					<h2 id={`${id}-heading`} className="font-semibold text-lg">
						{title}
					</h2>
					<p className="max-w-2xl text-muted-foreground text-sm">
						{description}
					</p>
				</div>
				{action ? <div className="shrink-0">{action}</div> : null}
			</div>
			{children}
		</section>
	);
}

function ConnectionCardSkeleton() {
	return (
		<Card aria-hidden>
			<CardHeader className="flex items-center gap-3">
				<Skeleton className="size-10 rounded-lg" />
				<div className="flex flex-1 flex-col gap-2">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-3 w-40" />
				</div>
			</CardHeader>
			<CardContent className="gap-2.5">
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-4 w-1/2" />
			</CardContent>
		</Card>
	);
}
