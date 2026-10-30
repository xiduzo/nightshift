import type { CustomAgent } from "@nightshift/flows";
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
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { CircleAlertIcon } from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { settingsQueries } from "@/features/settings/queries";
import type {
	AgentProfileRow,
	CliTool,
	Connection,
	HarnessRow,
	ModelProfileRow,
	OtherDevice,
	ProfileRow,
} from "@/shared/api";
import { type Crumb, SiteHeader } from "@/shared/page";
import { Detail } from "./agents-detail";
import { AgentsOverview } from "./agents-overview";
import { itemOf, parseItem, type Selection } from "./agents-selection";
import { CliToolDialog } from "./cli-tool";
import { ConnectionDialog } from "./connections/connection-dialog";
import { CustomAgentDialog } from "./custom-agent";
import { HarnessPicker } from "./harness-detail";
import {
	cliToolQueries,
	connectionQueries,
	deciderQueries,
	harnessQueries,
	otherDeviceQueries,
	profileQueries,
} from "./queries";
import { ToolPicker } from "./tool-detail";

/**
 * The Agents page. With nothing picked it shows the overview: profiles,
 * model profiles, harnesses, tools and your other devices. A pick opens
 * its detail in place, and the breadcrumb leads back. Leaving a profile
 * with unsaved changes asks first.
 */
export function AgentsPage({
	item,
	onSelect,
}: {
	item: string | undefined;
	onSelect: (item: string | undefined) => void;
}) {
	const profiles = useQuery(profileQueries.list());
	const harnesses = useQuery(harnessQueries.list());
	const tools = useQuery(connectionQueries.list());
	const cliTools = useQuery(cliToolQueries.list());
	const settings = useQuery(settingsQueries.get());
	const otherDevices = useQuery(otherDeviceQueries.list());
	const deciders = useQuery(deciderQueries.list());
	const navigate = useNavigate();
	const [picking, setPicking] = useState<"harness" | "tool" | null>(null);
	const [editing, setEditing] = useState<{
		open: boolean;
		connection: Connection | null;
		kind?: "command" | "url";
	}>({ open: false, connection: null });
	const [editingCli, setEditingCli] = useState<{
		open: boolean;
		tool: CliTool | null;
	}>({ open: false, tool: null });
	const [editingAgent, setEditingAgent] = useState<{
		open: boolean;
		agent: CustomAgent | null;
	}>({ open: false, agent: null });

	// Unsaved changes in a profile form: any way out asks first.
	const dirty = useRef(false);
	const setDirty = useCallback((next: boolean) => {
		dirty.current = next;
	}, []);
	const blocker = useBlocker({
		shouldBlockFn: () => dirty.current,
		enableBeforeUnload: () => dirty.current,
		withResolver: true,
	});
	const select = (selection: Selection | null) =>
		onSelect(selection ? itemOf(selection) : undefined);
	/** Goes without asking: after a save, a delete or a cancel. */
	const go = useCallback(
		(selection: Selection | null) => {
			dirty.current = false;
			onSelect(selection ? itemOf(selection) : undefined);
		},
		[onSelect],
	);

	const added = (harnesses.data ?? []).filter((h) => h.added);
	const agentProfiles = (profiles.data ?? []).filter(
		(p): p is AgentProfileRow => "harness" in p,
	);
	const modelProfiles = (profiles.data ?? []).filter(
		(p): p is ModelProfileRow => "decider" in p,
	);
	const deciderLabel = (name: string) =>
		deciders.data?.find((d) => d.name === name)?.label ?? name;
	const connections = tools.data?.connections ?? [];
	const selection = parseItem(item);

	const error =
		profiles.error ?? harnesses.error ?? tools.error ?? cliTools.error;
	const loading =
		profiles.isPending ||
		harnesses.isPending ||
		tools.isPending ||
		cliTools.isPending;

	const crumbs: Crumb[] = selection
		? [
				{ label: "Agents", link: { to: "/agents", search: {} } },
				{
					label: selectionLabel(selection, {
						profiles: profiles.data ?? [],
						harnesses: added,
						otherDevices: otherDevices.data ?? [],
					}),
				},
			]
		: [{ label: "Agents" }];

	return (
		<>
			<SiteHeader crumbs={crumbs} />
			{error ? (
				<div className="mx-auto w-full max-w-4xl p-4 md:p-6">
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>The agents did not load</AlertTitle>
						<AlertDescription>{error.message}</AlertDescription>
						<AlertAction>
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									void profiles.refetch();
									void harnesses.refetch();
									void tools.refetch();
									void cliTools.refetch();
								}}
							>
								Try again
							</Button>
						</AlertAction>
					</Alert>
				</div>
			) : loading ? (
				<div
					className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-6"
					aria-hidden
				>
					<Skeleton className="h-12 w-72" />
					<Skeleton className="h-40 w-full" />
					<Skeleton className="h-40 w-full" />
				</div>
			) : selection ? (
				<Detail
					selection={selection}
					onSelect={select}
					onGo={go}
					onDirtyChange={setDirty}
					onEditTool={(connection) => setEditing({ open: true, connection })}
					onEditCliTool={(tool) => setEditingCli({ open: true, tool })}
					onEditAgent={(agent) => setEditingAgent({ open: true, agent })}
					onOpenSecrets={() => void navigate({ to: "/secrets" })}
					data={{
						profiles: profiles.data ?? [],
						harnesses: harnesses.data ?? [],
						connections,
						cliTools: cliTools.data ?? [],
						settings: settings.data,
						otherDevices: otherDevices.data ?? [],
					}}
				/>
			) : (
				<AgentsOverview
					agentProfiles={agentProfiles}
					modelProfiles={modelProfiles}
					harnesses={added}
					cliTools={cliTools.data ?? []}
					connections={connections}
					otherDevices={otherDevices.data ?? []}
					deciderLabel={deciderLabel}
					onSelect={select}
					onAddHarness={() => setPicking("harness")}
					onAddTool={() => setPicking("tool")}
				/>
			)}

			<HarnessPicker
				open={picking === "harness"}
				onOpenChange={(open) => setPicking(open ? "harness" : null)}
				harnesses={harnesses.data}
				onAdded={(name) => select({ kind: "harness", name })}
				onAddCustom={() => setEditingAgent({ open: true, agent: null })}
			/>
			<CustomAgentDialog
				open={editingAgent.open}
				onOpenChange={(open) => setEditingAgent((e) => ({ ...e, open }))}
				agent={editingAgent.agent}
				taken={(harnesses.data ?? []).flatMap((h) =>
					h.custom ? [h.custom.slug] : [],
				)}
				onSaved={(slug) => select({ kind: "harness", name: `acp:${slug}` })}
			/>
			<ToolPicker
				open={picking === "tool"}
				onOpenChange={(open) => setPicking(open ? "tool" : null)}
				onPick={(kind) => {
					setPicking(null);
					if (kind === "cli") setEditingCli({ open: true, tool: null });
					else setEditing({ open: true, connection: null, kind: "command" });
				}}
			/>
			<CliToolDialog
				open={editingCli.open}
				onOpenChange={(open) => setEditingCli((e) => ({ ...e, open }))}
				tool={editingCli.tool}
				taken={(cliTools.data ?? []).map((t) => t.name)}
				onSaved={(name) => select({ kind: "cli", name })}
			/>
			<ConnectionDialog
				open={editing.open}
				onOpenChange={(open) => setEditing((e) => ({ ...e, open }))}
				connection={editing.connection}
				kind={editing.kind}
				taken={connections.map((c) => c.name)}
				onSaved={(name) => select({ kind: "tool", name })}
			/>
			<AlertDialog
				open={blocker.status === "blocked"}
				onOpenChange={(open) => {
					if (!open && blocker.status === "blocked") blocker.reset();
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Discard your changes?</AlertDialogTitle>
						<AlertDialogDescription>
							The profile has changes that are not saved.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep editing</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								dirty.current = false;
								if (blocker.status === "blocked") blocker.proceed();
							}}
						>
							Discard
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

/** The last crumb: the name of what is open. */
function selectionLabel(
	selection: Selection,
	data: {
		profiles: ProfileRow[];
		harnesses: HarnessRow[];
		otherDevices: OtherDevice[];
	},
): ReactNode {
	switch (selection.kind) {
		case "new-profile":
			return "New profile";
		case "new-model-profile":
			return "New model profile";
		case "profile": {
			const name = data.profiles.find((p) => p.id === selection.id)?.name;
			return <span className="font-mono">{name ?? "Profile"}</span>;
		}
		case "harness":
			return (
				data.harnesses.find((h) => h.name === selection.name)?.label ??
				"Harness"
			);
		case "tool":
		case "cli":
			return <span className="font-mono">{selection.name}</span>;
		case "device":
			return (
				data.otherDevices.find((d) => d.id === selection.id)?.name ?? "Device"
			);
	}
}
