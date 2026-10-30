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
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card } from "@nightshift/ui/components/card";
import { ScrollArea } from "@nightshift/ui/components/scroll-area";
import { Separator } from "@nightshift/ui/components/separator";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { BotIcon, CircleAlertIcon } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { settingsQueries } from "@/features/settings/queries";
import type {
	AgentProfileRow,
	CliTool,
	Connection,
	ModelProfileRow,
	OtherDevice,
	ProfileRow,
} from "@/shared/api";
import { SiteHeader } from "@/shared/page";
import { PanelHeader } from "@/shared/panel";
import { Detail } from "./agents-detail";
import { Group, ListItem, ListSkeleton } from "./agents-list";
import { itemOf, parseItem, type Selection } from "./agents-selection";
import { CliToolCheckBadge, CliToolDialog } from "./cli-tool";
import { CliCheckBadge } from "./connections/cli-panel";
import { ConnectionDialog } from "./connections/connection-dialog";
import { CustomAgentDialog } from "./custom-agent";
import { FoundPrograms } from "./found-programs";
import { HarnessPicker } from "./harness-detail";
import { harnessInfo } from "./harnesses";
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
 * The Agents page: Agent Profiles, the harnesses they run on, the tools they
 * hand out, and the secrets those tools read, all on this computer. Your
 * other devices show their profiles and secret names, read-only. The
 * selected thing opens on the left; the list sits in a card on the right,
 * like the flow inspector. Each pane scrolls on its own.
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

	/** Shows it, unsaved changes or not: after a save, a delete, a cancel. */
	const go = useCallback(
		(selection: Selection | null) =>
			onSelect(selection ? itemOf(selection) : undefined),
		[onSelect],
	);
	// Unsaved changes in the profile form: ask before showing something else.
	const dirty = useRef(false);
	const setDirty = useCallback((next: boolean) => {
		dirty.current = next;
	}, []);
	const [leaving, setLeaving] = useState<{ to: Selection | null } | null>(null);
	const select = (selection: Selection | null) => {
		if (dirty.current) setLeaving({ to: selection });
		else go(selection);
	};
	const added = (harnesses.data ?? []).filter((h) => h.added);
	const agentProfiles = profiles.data?.filter(
		(p): p is AgentProfileRow => "harness" in p,
	);
	const modelProfiles = profiles.data?.filter(
		(p): p is ModelProfileRow => "decider" in p,
	);
	const deciders = useQuery(deciderQueries.list());
	const deciderLabel = (name: string) =>
		deciders.data?.find((d) => d.name === name)?.label ?? name;
	const connections = tools.data?.connections ?? [];
	const secrets = tools.data?.secrets ?? [];
	const missingSecrets = secrets.filter(
		(s) => !s.saved && !s.inEnv && (s.usedBy.length > 0 || s.flows.length > 0),
	).length;

	// Nothing chosen: the first profile, else the empty state.
	const firstProfile = agentProfiles?.[0] ?? modelProfiles?.[0];
	const selection =
		parseItem(item) ??
		(firstProfile ? { kind: "profile" as const, id: firstProfile.id } : null);
	const isSel = (s: Selection) =>
		selection !== null && itemOf(selection) === itemOf(s);

	const error =
		profiles.error ?? harnesses.error ?? tools.error ?? cliTools.error;
	const loading =
		profiles.isPending ||
		harnesses.isPending ||
		tools.isPending ||
		cliTools.isPending;

	return (
		<>
			<SiteHeader crumbs={[{ label: "Agents" }]} />
			<div className="flex h-[calc(100svh-3.5rem)] min-h-0">
				<div className="min-w-0 flex-1 overflow-y-auto">
					{error ? (
						<div className="p-8">
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
							className="mx-auto flex max-w-6xl flex-col gap-6 p-8"
							aria-hidden
						>
							<Skeleton className="h-12 w-72" />
							<Skeleton className="h-40 w-full" />
							<Skeleton className="h-40 w-full" />
						</div>
					) : (
						<>
							<FoundPrograms onSetUp={go} />
							<Detail
								selection={selection}
								onSelect={select}
								onGo={go}
								onDirtyChange={setDirty}
								onEditTool={(connection) =>
									setEditing({ open: true, connection })
								}
								onEditCliTool={(tool) => setEditingCli({ open: true, tool })}
								onEditAgent={(agent) => setEditingAgent({ open: true, agent })}
								data={{
									profiles: profiles.data ?? [],
									harnesses: harnesses.data ?? [],
									connections,
									cliTools: cliTools.data ?? [],
									secrets,
									settings: settings.data,
									otherDevices: otherDevices.data ?? [],
								}}
							/>
						</>
					)}
				</div>

				<aside className="w-80 shrink-0 p-3 lg:p-4 lg:pl-2">
					<Card className="h-full gap-0 py-0">
						<ScrollArea className="h-full min-h-0">
							<PanelHeader
								icon={BotIcon}
								kicker="Agents"
								title="Profiles and tools"
								mono={false}
							/>
							<nav aria-label="Agents" className="flex flex-col">
								<Group
									title="Profiles"
									count={agentProfiles?.length}
									addLabel="Add a profile"
									onAdd={() => select({ kind: "new-profile" })}
								>
									{profiles.isPending ? (
										<ListSkeleton />
									) : (
										(agentProfiles ?? []).map((p) => (
											<ListItem
												key={p.id}
												selected={isSel({ kind: "profile", id: p.id })}
												onClick={() => select({ kind: "profile", id: p.id })}
												title={<span className="font-mono">{p.name}</span>}
												description={`${harnessInfo(p.harness).label} · ${p.model}`}
												aside={<UsedIn usedBy={p.usedBy} />}
											/>
										))
									)}
									{isSel({ kind: "new-profile" }) ? (
										<ListItem
											selected
											onClick={() => {}}
											title={
												<span className="text-muted-foreground">
													New profile
												</span>
											}
										/>
									) : null}
								</Group>
								<Group
									title="Model profiles"
									count={modelProfiles?.length}
									addLabel="Add a model profile"
									onAdd={() => select({ kind: "new-model-profile" })}
								>
									{profiles.isPending ? (
										<ListSkeleton />
									) : (
										(modelProfiles ?? []).map((p) => (
											<ListItem
												key={p.id}
												selected={isSel({ kind: "profile", id: p.id })}
												onClick={() => select({ kind: "profile", id: p.id })}
												title={<span className="font-mono">{p.name}</span>}
												description={`${deciderLabel(p.decider)} · ${p.model ?? "default model"}`}
												aside={<UsedIn usedBy={p.usedBy} />}
											/>
										))
									)}
									{isSel({ kind: "new-model-profile" }) ? (
										<ListItem
											selected
											onClick={() => {}}
											title={
												<span className="text-muted-foreground">
													New model profile
												</span>
											}
										/>
									) : null}
								</Group>
								<Group
									title="Harnesses"
									count={harnesses.isPending ? undefined : added.length}
									addLabel="Add a harness"
									onAdd={() => setPicking("harness")}
								>
									{harnesses.isPending ? (
										<ListSkeleton />
									) : (
										added.map((h) => (
											<ListItem
												key={h.name}
												selected={isSel({ kind: "harness", name: h.name })}
												onClick={() =>
													select({ kind: "harness", name: h.name })
												}
												title={h.label}
												description={h.custom ? "Custom agent" : undefined}
												aside={<CliCheckBadge target={h.name} />}
											/>
										))
									)}
								</Group>
								<Group
									title="Tools"
									count={
										cliTools.isPending || tools.isPending
											? undefined
											: (cliTools.data ?? []).length + connections.length
									}
									addLabel="Add a tool"
									onAdd={() => setPicking("tool")}
								>
									{cliTools.isPending ? (
										<ListSkeleton />
									) : (
										(cliTools.data ?? []).map((t) => (
											<ListItem
												key={`cli:${t.name}`}
												selected={isSel({ kind: "cli", name: t.name })}
												onClick={() => select({ kind: "cli", name: t.name })}
												title={<span className="font-mono">{t.name}</span>}
												description="CLI"
												aside={<CliToolCheckBadge name={t.name} />}
											/>
										))
									)}
									{tools.isPending ? (
										<ListSkeleton />
									) : (
										connections.map((c) => {
											const missing = c.variables.filter(
												(v) => v.source === "missing",
											).length;
											return (
												<ListItem
													key={c.name}
													selected={isSel({ kind: "tool", name: c.name })}
													onClick={() => select({ kind: "tool", name: c.name })}
													title={<span className="font-mono">{c.name}</span>}
													description="MCP server"
													aside={
														missing > 0 ? (
															<Badge
																variant="outline"
																className="text-status-waiting"
															>
																Secret missing
															</Badge>
														) : null
													}
												/>
											);
										})
									)}
								</Group>
								{(otherDevices.data ?? []).length > 0 ? (
									<Group
										title="Your other devices"
										count={otherDevices.data?.length}
									>
										{(otherDevices.data ?? []).map((d) => (
											<ListItem
												key={d.id}
												selected={isSel({ kind: "device", id: d.id })}
												onClick={() => select({ kind: "device", id: d.id })}
												title={d.name}
												description={deviceSummary(d)}
											/>
										))}
									</Group>
								) : null}
								<Separator />
								<div className="p-2">
									<ListItem
										selected={isSel({ kind: "secrets" })}
										onClick={() => select({ kind: "secrets" })}
										title="Secrets"
										aside={
											missingSecrets > 0 ? (
												<Badge
													variant="outline"
													className="text-status-waiting"
												>
													{missingSecrets} missing
												</Badge>
											) : (
												<Badge variant="secondary">{secrets.length}</Badge>
											)
										}
									/>
								</div>
							</nav>
						</ScrollArea>
					</Card>
				</aside>

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
					open={leaving !== null}
					onOpenChange={(open) => (open ? null : setLeaving(null))}
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
									const to = leaving?.to ?? null;
									dirty.current = false;
									setLeaving(null);
									go(to);
								}}
							>
								Discard
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</>
	);
}

/** How many flows use a profile, with their names on hover. */
function UsedIn({ usedBy }: { usedBy: ProfileRow["usedBy"] }) {
	return (
		<span
			className="text-muted-foreground text-xs"
			title={usedBy.map((u) => u.flowName).join(", ")}
		>
			{usedBy.length === 0
				? "Not used"
				: `In ${usedBy.length} ${usedBy.length === 1 ? "flow" : "flows"}`}
		</span>
	);
}

/** What a list row says of another device: how many profiles and secrets it has. */
function deviceSummary(device: OtherDevice): string {
	const profiles = device.profiles.length;
	const secrets = device.secrets.length;
	return `${profiles} ${profiles === 1 ? "profile" : "profiles"} · ${secrets} ${secrets === 1 ? "secret" : "secrets"}`;
}
