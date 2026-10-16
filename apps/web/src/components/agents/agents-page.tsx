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
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Separator } from "@nightshift/ui/components/separator";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import {
	BotIcon,
	CircleAlertIcon,
	GlobeIcon,
	KeyRoundIcon,
	PlusIcon,
	SquareTerminalIcon,
	WrenchIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { CliCheckBadge } from "@/components/connections/cli-panel";
import { ConnectionDialog } from "@/components/connections/connection-dialog";
import { SecretsCard } from "@/components/connections/secrets-card";
import type {
	Connection,
	ConnectionList,
	SecretView,
	SettingsView,
} from "@/components/connections/types";
import { harnessInfo } from "@/lib/harnesses";
import { orpc } from "@/utils/orpc";

import { HarnessDetail, HarnessPicker } from "./harness-detail";
import { newProfileDraft, ProfileDetail } from "./profile-detail";
import { GithubToolsetDetail, ToolDetail, ToolPicker } from "./tool-detail";
import type { HarnessName, HarnessRow, ProfileRow } from "./types";

/** What the detail pane shows, as it sits in the URL (`?item=profile:builder`). */
export type Selection =
	| { kind: "profile"; name: string }
	| { kind: "new-profile" }
	| { kind: "harness"; name: HarnessName }
	| { kind: "tool"; name: string }
	| { kind: "github" }
	| { kind: "secrets" };

export function parseItem(item: string | undefined): Selection | null {
	if (!item) return null;
	const [kind, name = ""] = item.split(":", 2) as [string, string?];
	switch (kind) {
		case "profile":
			return name ? { kind, name } : null;
		case "harness":
			return ["claude-code", "opencode", "codex"].includes(name)
				? { kind, name: name as HarnessName }
				: null;
		case "tool":
			return name ? { kind, name } : null;
		case "new-profile":
		case "github":
		case "secrets":
			return { kind };
		default:
			return null;
	}
}

export function itemOf(selection: Selection): string {
	return "name" in selection
		? `${selection.kind}:${selection.name}`
		: selection.kind;
}

/**
 * The Agents page: Agent Profiles, the harnesses they run on, the tools they
 * hand out, and the secrets those tools read. A list on the left; the
 * selected thing opens on the right. Each pane scrolls on its own.
 */
export function AgentsPage({
	item,
	onSelect,
}: {
	item: string | undefined;
	onSelect: (item: string | undefined) => void;
}) {
	const profiles = useQuery(orpc.profiles.list.queryOptions());
	const harnesses = useQuery(orpc.harnesses.list.queryOptions());
	const tools = useQuery(orpc.connections.list.queryOptions());
	const settings = useQuery(orpc.settings.get.queryOptions());
	const [picking, setPicking] = useState<"harness" | "tool" | null>(null);
	const [editing, setEditing] = useState<{
		open: boolean;
		connection: Connection | null;
		kind?: "command" | "url";
	}>({ open: false, connection: null });

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
	const connections = tools.data?.connections ?? [];
	const secrets = tools.data?.secrets ?? [];
	const missingSecrets = secrets.filter(
		(s) => !s.saved && !s.inEnv && s.usedBy.length > 0,
	).length;

	// Nothing chosen: the first profile, else the empty state.
	const firstProfile = profiles.data?.[0];
	const selection =
		parseItem(item) ??
		(firstProfile
			? { kind: "profile" as const, name: firstProfile.name }
			: null);
	const isSel = (s: Selection) =>
		selection !== null && itemOf(selection) === itemOf(s);

	const error = profiles.error ?? harnesses.error ?? tools.error;
	const loading = profiles.isPending || harnesses.isPending || tools.isPending;

	return (
		<div className="flex h-[calc(100svh-3.5rem)] min-h-0">
			<nav
				aria-label="Agents"
				className="flex w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r p-4"
			>
				<Group
					title="Profiles"
					hint="What Agent nodes pick"
					addLabel="Add a profile"
					onAdd={() => select({ kind: "new-profile" })}
				>
					{profiles.isPending ? (
						<ListSkeleton />
					) : (
						(profiles.data ?? []).map((p) => {
							const nodes = p.usedBy.reduce((n, u) => n + u.nodeIds.length, 0);
							return (
								<ListItem
									key={p.name}
									selected={isSel({ kind: "profile", name: p.name })}
									onClick={() => select({ kind: "profile", name: p.name })}
									icon={<BotIcon />}
									title={<span className="font-mono">{p.name}</span>}
									description={`${harnessInfo(p.harness).label} · ${p.model}`}
									aside={
										<Badge
											variant="secondary"
											title={`${nodes} Agent ${nodes === 1 ? "node" : "nodes"}`}
										>
											{nodes}
										</Badge>
									}
								/>
							);
						})
					)}
					{isSel({ kind: "new-profile" }) ? (
						<ListItem
							selected
							onClick={() => {}}
							icon={<BotIcon />}
							title={<span className="text-muted-foreground">New profile</span>}
						/>
					) : null}
				</Group>
				<Separator />
				<Group
					title="Harnesses"
					hint="Coding agents your profiles use"
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
								onClick={() => select({ kind: "harness", name: h.name })}
								icon={<SquareTerminalIcon />}
								title={h.label}
								aside={<CliCheckBadge target={h.name} />}
							/>
						))
					)}
				</Group>
				<Separator />
				<Group
					title="Tools"
					hint="Extra tools for your agents"
					addLabel="Add a tool"
					onAdd={() => setPicking("tool")}
				>
					<ListItem
						selected={isSel({ kind: "github" })}
						onClick={() => select({ kind: "github" })}
						icon={<WrenchIcon />}
						title={<span className="font-mono">github</span>}
						aside={<CliCheckBadge target="github" />}
					/>
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
									icon={
										"url" in c.server ? <GlobeIcon /> : <SquareTerminalIcon />
									}
									title={<span className="font-mono">{c.name}</span>}
									aside={
										missing > 0 ? (
											<Badge variant="outline" className="text-status-waiting">
												Secret missing
											</Badge>
										) : null
									}
								/>
							);
						})
					)}
				</Group>
				<Separator />
				<ListItem
					selected={isSel({ kind: "secrets" })}
					onClick={() => select({ kind: "secrets" })}
					icon={<KeyRoundIcon />}
					title="Secrets"
					aside={
						missingSecrets > 0 ? (
							<Badge variant="outline" className="text-status-waiting">
								{missingSecrets} missing
							</Badge>
						) : (
							<Badge variant="secondary">{secrets.length}</Badge>
						)
					}
				/>
			</nav>

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
					<Detail
						selection={selection}
						onSelect={select}
						onGo={go}
						onDirtyChange={setDirty}
						onEditTool={(connection) => setEditing({ open: true, connection })}
						data={{
							profiles: profiles.data ?? [],
							harnesses: harnesses.data ?? [],
							connections,
							secrets,
							settings: settings.data,
						}}
					/>
				)}
			</div>

			<HarnessPicker
				open={picking === "harness"}
				onOpenChange={(open) => setPicking(open ? "harness" : null)}
				harnesses={harnesses.data}
				onAdded={(name) => select({ kind: "harness", name })}
			/>
			<ToolPicker
				open={picking === "tool"}
				onOpenChange={(open) => setPicking(open ? "tool" : null)}
				onPick={(kind) => {
					setPicking(null);
					setEditing({ open: true, connection: null, kind });
				}}
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
	);
}

type PageData = {
	profiles: ProfileRow[];
	harnesses: HarnessRow[];
	connections: ConnectionList["connections"];
	secrets: SecretView[];
	settings: SettingsView | undefined;
};

function Detail({
	selection,
	onSelect,
	onGo,
	onDirtyChange,
	onEditTool,
	data,
}: {
	selection: Selection | null;
	/** Asks first when the profile form has unsaved changes. */
	onSelect: (selection: Selection | null) => void;
	/** Goes at once: after a save, a delete or a cancel. */
	onGo: (selection: Selection | null) => void;
	onDirtyChange: (dirty: boolean) => void;
	onEditTool: (connection: Connection) => void;
	data: PageData;
}) {
	const added = data.harnesses.filter((h) => h.added);
	const openProfile = (name: string) => onSelect({ kind: "profile", name });

	if (!selection) {
		return (
			<Empty className="h-full">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<BotIcon />
					</EmptyMedia>
					<EmptyTitle>No agent profiles yet</EmptyTitle>
					<EmptyDescription>
						A profile gives a harness, a model and tools one name. Agent nodes
						use it, so one change here reaches every flow.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button size="sm" onClick={() => onSelect({ kind: "new-profile" })}>
						<PlusIcon data-icon="inline-start" />
						Add a profile
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	switch (selection.kind) {
		case "profile":
		case "new-profile": {
			const profile =
				selection.kind === "profile"
					? data.profiles.find((p) => p.name === selection.name)
					: null;
			if (profile === undefined) return <Gone what="profile" />;
			if (added.length === 0) {
				return (
					<Empty className="h-full">
						<EmptyHeader>
							<EmptyTitle>Add a harness first</EmptyTitle>
							<EmptyDescription>
								A profile runs on a harness: Claude Code, OpenCode or Codex. Add
								one with + next to Harnesses.
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				);
			}
			return (
				<ProfileDetail
					key={itemOf(selection)}
					profile={profile}
					initial={newProfileDraft(
						added,
						data.settings?.values.agentPermissionMode ?? "auto",
					)}
					profiles={data.profiles}
					harnesses={added}
					connections={data.connections}
					onSaved={(name) => onGo({ kind: "profile", name })}
					onDeleted={() => onGo(null)}
					onCancelNew={() => onGo(null)}
					onDirtyChange={onDirtyChange}
				/>
			);
		}
		case "harness": {
			const harness = added.find((h) => h.name === selection.name);
			if (!harness) return <Gone what="harness" />;
			return (
				<HarnessDetail
					key={harness.name}
					harness={harness}
					settings={data.settings}
					onOpenProfile={openProfile}
					onRemoved={() => onGo(null)}
				/>
			);
		}
		case "tool": {
			const connection = data.connections.find(
				(c) => c.name === selection.name,
			);
			if (!connection) return <Gone what="tool" />;
			return (
				<ToolDetail
					key={connection.name}
					connection={connection}
					onEdit={() => onEditTool(connection)}
					onOpenProfile={openProfile}
					onOpenSecrets={() => onSelect({ kind: "secrets" })}
					onRemoved={() => onGo(null)}
				/>
			);
		}
		case "github":
			return (
				<GithubToolsetDetail
					settings={data.settings}
					profiles={data.profiles
						.filter((p) => p.tools.includes("github"))
						.map((p) => p.name)}
					onOpenProfile={openProfile}
				/>
			);
		case "secrets":
			return (
				<div className="mx-auto w-full max-w-6xl px-4 py-8 md:px-8">
					<SecretsCard secrets={data.secrets} />
				</div>
			);
	}
}

function Gone({ what }: { what: string }) {
	return (
		<Empty className="h-full">
			<EmptyHeader>
				<EmptyTitle>No such {what}</EmptyTitle>
				<EmptyDescription>
					It was removed or renamed. Pick another one on the left.
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

function Group({
	title,
	hint,
	addLabel,
	onAdd,
	children,
}: {
	title: string;
	hint: string;
	addLabel: string;
	onAdd: () => void;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1">
			<div className="flex items-center justify-between px-2">
				<div>
					<h2 className="font-medium text-sm">{title}</h2>
					<p className="text-muted-foreground text-xs">{hint}</p>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={addLabel}
					title={addLabel}
					onClick={onAdd}
				>
					<PlusIcon />
				</Button>
			</div>
			<ItemGroup className="gap-0.5">{children}</ItemGroup>
		</section>
	);
}

function ListItem({
	selected,
	onClick,
	icon,
	title,
	description,
	aside,
}: {
	selected: boolean;
	onClick: () => void;
	icon: ReactNode;
	title: ReactNode;
	description?: string;
	aside?: ReactNode;
}) {
	return (
		<Item
			size="xs"
			variant={selected ? "muted" : "default"}
			render={
				<button
					type="button"
					className="text-left"
					aria-current={selected ? "page" : undefined}
				/>
			}
			onClick={onClick}
		>
			<ItemMedia variant="icon">{icon}</ItemMedia>
			<ItemContent className="min-w-0">
				<ItemTitle className="max-w-full truncate">{title}</ItemTitle>
				{description ? (
					<ItemDescription className="truncate text-xs">
						{description}
					</ItemDescription>
				) : null}
			</ItemContent>
			{aside ? <ItemActions>{aside}</ItemActions> : null}
		</Item>
	);
}

function ListSkeleton() {
	return (
		<div className="flex flex-col gap-2 px-2 py-1" aria-hidden>
			<Skeleton className="h-8 w-full" />
			<Skeleton className="h-8 w-full" />
		</div>
	);
}
