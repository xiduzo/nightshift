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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	GlobeIcon,
	PencilIcon,
	PlugIcon,
	SquareTerminalIcon,
	WrenchIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CliPanel, toolFor } from "@/components/connections/cli-panel";
import {
	FactList,
	OffMachineNote,
	VariableBadge,
} from "@/components/connections/parts";
import { McpTestOutcome } from "@/components/connections/test-result";
import type { Connection, SettingsView } from "@/components/connections/types";
import { orpc } from "@/utils/orpc";

import { DetailSection, DetailShell } from "./detail-shell";

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

/** An MCP server defined on this daemon (a connection). */
export function ToolDetail({
	connection,
	onEdit,
	onOpenProfile,
	onOpenSecrets,
	onRemoved,
}: {
	connection: Connection;
	onEdit: () => void;
	onOpenProfile: (name: string) => void;
	onOpenSecrets: () => void;
	onRemoved: () => void;
}) {
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState(false);
	const test = useMutation(orpc.connections.test.mutationOptions());
	const remove = useMutation(
		orpc.connections.remove.mutationOptions({
			onSuccess: () => {
				toast.success(`Removed ${connection.name}`);
				void queryClient.invalidateQueries({
					queryKey: orpc.connections.list.key(),
				});
				void queryClient.invalidateQueries({ queryKey: orpc.profiles.key() });
				onRemoved();
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);

	const server = connection.server;
	const remote = "url" in server ? server : null;
	const local = "command" in server ? server : null;

	return (
		<DetailShell
			icon={remote ? <GlobeIcon /> : <SquareTerminalIcon />}
			kicker={
				remote
					? "Tool · MCP server at a URL"
					: "Tool · MCP server, a local command"
			}
			title={connection.name}
			mono
			subtitle={connection.description ?? undefined}
			actions={[
				{ label: "Edit", onSelect: onEdit },
				{
					label: "Remove",
					destructive: true,
					onSelect: () => setRemoving(true),
				},
			]}
		>
			<DetailSection
				title="Server"
				description={
					remote
						? "A server that is already running. Night Shift connects to it when an agent needs its tools."
						: "Night Shift starts it on this computer when an agent needs its tools."
				}
			>
				<div className="flex flex-col gap-4">
					<FactList
						facts={[
							local
								? {
										label: "Command",
										value: (
											<span className="break-all font-mono text-xs leading-5">
												{commandLine(local.command, local.args)}
											</span>
										),
									}
								: {
										label: "URL",
										value: (
											<span className="break-all font-mono text-xs leading-5">
												{remote?.url}
											</span>
										),
									},
						]}
					/>
					{remote ? (
						<OffMachineNote>
							Tool calls and their arguments go to{" "}
							<span className="font-mono">{host(remote.url)}</span>.
						</OffMachineNote>
					) : null}
					<div className="flex flex-wrap gap-2">
						<Button variant="outline" size="sm" onClick={onEdit}>
							<PencilIcon data-icon="inline-start" />
							Edit
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={test.isPending}
							onClick={() => test.mutate({ name: connection.name })}
						>
							{test.isPending ? (
								<Spinner data-icon="inline-start" />
							) : (
								<PlugIcon data-icon="inline-start" />
							)}
							{test.isPending ? "Testing…" : "Test"}
						</Button>
					</div>
					{test.isPending || test.data || test.error ? (
						<McpTestOutcome
							pending={test.isPending}
							result={test.data}
							error={test.error}
						/>
					) : null}
				</div>
			</DetailSection>

			<DetailSection
				title="Secrets"
				description={
					<>
						The secrets it uses, written as{" "}
						<span className="font-mono">${"{NAME}"}</span>. Save their values
						under Secrets.
					</>
				}
			>
				{connection.variables.length === 0 ? (
					<p className="text-muted-foreground text-sm">None.</p>
				) : (
					<div className="flex flex-col items-start gap-3">
						<ul className="flex flex-wrap gap-1.5">
							{connection.variables.map((variable) => (
								<li key={variable.name}>
									<VariableBadge
										name={variable.name}
										source={variable.source}
									/>
								</li>
							))}
						</ul>
						<Button
							variant="link"
							size="xs"
							className="px-0"
							onClick={onOpenSecrets}
						>
							Manage secrets
						</Button>
					</div>
				)}
			</DetailSection>

			<UsedBySection
				profiles={connection.profiles}
				flows={connection.usedBy}
				onOpenProfile={onOpenProfile}
			/>

			<AlertDialog open={removing} onOpenChange={setRemoving}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove {connection.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							{[
								connection.profiles.length > 0
									? `It is taken off the profiles ${connection.profiles.join(", ")}.`
									: null,
								connection.usedBy.length > 0
									? `Flows that use it (${connection.usedBy.map((u) => u.flowName).join(", ")}) cannot run until you take it out of their nodes.`
									: null,
							]
								.filter(Boolean)
								.join(" ") || "Nothing uses it."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => remove.mutate({ name: connection.name })}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DetailShell>
	);
}

function UsedBySection({
	profiles,
	flows,
	onOpenProfile,
}: {
	profiles: string[];
	flows: { projectId: string; projectName: string; flowName: string }[];
	onOpenProfile: (name: string) => void;
}) {
	return (
		<DetailSection
			title="Used by"
			description="The profiles and flows that use it."
		>
			{profiles.length === 0 && flows.length === 0 ? (
				<p className="text-muted-foreground text-sm">Nothing uses it yet.</p>
			) : (
				<div className="flex flex-col gap-3">
					{profiles.length > 0 ? (
						<div className="flex flex-wrap gap-1.5">
							{profiles.map((name) => (
								<Button
									key={name}
									variant="secondary"
									size="xs"
									className="font-mono"
									onClick={() => onOpenProfile(name)}
								>
									<BotIcon data-icon="inline-start" />
									{name}
								</Button>
							))}
						</div>
					) : null}
					{flows.length > 0 ? (
						<ItemGroup className="gap-1">
							{flows.map((use) => (
								<Item
									key={`${use.projectId}/${use.flowName}`}
									size="xs"
									variant="outline"
									render={
										<Link
											to="/projects/$projectId/flows/$name"
											params={{ projectId: use.projectId, name: use.flowName }}
										/>
									}
								>
									<ItemContent>
										<ItemTitle>
											<span className="text-muted-foreground">
												{use.projectName} /
											</span>
											<span className="font-mono">{use.flowName}</span>
										</ItemTitle>
									</ItemContent>
								</Item>
							))}
						</ItemGroup>
					) : null}
				</div>
			)}
		</DetailSection>
	);
}

/** The built-in GitHub tool set: Night Shift's own tools, through `gh`. */
export function GithubToolsetDetail({
	settings,
	profiles,
	onOpenProfile,
}: {
	settings: SettingsView | undefined;
	profiles: string[];
	onOpenProfile: (name: string) => void;
}) {
	return (
		<DetailShell
			icon={<WrenchIcon />}
			kicker="Tool · built-in tool set"
			title="github"
			mono
			subtitle="Read issues and pull requests, comment, set labels, and open a pull request. For Each nodes also use it to read lists from GitHub."
		>
			<DetailSection
				title="GitHub CLI"
				description="Uses your own GitHub CLI login. There is nothing else to set up."
			>
				<CliPanel tool={toolFor("github")} settings={settings} />
			</DetailSection>
			<UsedBySection
				profiles={profiles}
				flows={[]}
				onOpenProfile={onOpenProfile}
			/>
		</DetailShell>
	);
}

/** "Add a tool": an MCP server as a local command or at a URL. */
export function ToolPicker({
	open,
	onOpenChange,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onPick: (kind: "command" | "url") => void;
}) {
	const options = [
		{
			kind: "command" as const,
			title: "MCP server · local command",
			blurb:
				"Night Shift starts it on this computer, for example with npx or bunx.",
			icon: SquareTerminalIcon,
		},
		{
			kind: "url" as const,
			title: "MCP server · URL",
			blurb: "A server that is already running, local or hosted.",
			icon: GlobeIcon,
		},
	];
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add a tool</DialogTitle>
					<DialogDescription>
						Give your agents more tools through an MCP server, next to their
						built-in tools. The github tools are already included.
					</DialogDescription>
				</DialogHeader>
				<ItemGroup className="gap-2">
					{options.map((option) => (
						<Item
							key={option.kind}
							variant="outline"
							render={<button type="button" className="text-left" />}
							onClick={() => onPick(option.kind)}
						>
							<ItemMedia variant="icon">
								<option.icon />
							</ItemMedia>
							<ItemContent>
								<ItemTitle>{option.title}</ItemTitle>
								<ItemDescription className="text-xs">
									{option.blurb}
								</ItemDescription>
							</ItemContent>
						</Item>
					))}
				</ItemGroup>
			</DialogContent>
		</Dialog>
	);
}
