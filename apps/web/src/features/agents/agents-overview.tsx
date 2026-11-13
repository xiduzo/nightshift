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
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { Link } from "@tanstack/react-router";
import { BotIcon, DownloadIcon, PlusIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useState } from "react";
import type {
	AgentProfileRow,
	CliTool,
	Connection,
	HarnessRow,
	ModelProfileRow,
	OtherDevice,
	ProfileRow,
} from "@/shared/api";
import { HeaderActions, PageHeading, PageSection } from "@/shared/page";
import { itemOf, type Selection } from "./agents-selection";
import { CliToolCheckBadge } from "./cli-tool";
import { CliCheckBadge } from "./connections/cli-panel";
import { useFoundPrograms } from "./found-programs";
import { harnessInfo } from "./harnesses";
import {
	AgentSetupDialog,
	useAgentSetupStatus,
} from "./setup/agent-setup-dialog";

/** PROTOTYPE, throw away: one part of the page, shown inside Settings. */
export type AgentsPart = {
	only: "profiles" | "models" | "harnesses" | "tools";
	/** The search of a link in Settings that opens `item`. */
	search: (item: string | undefined) => { section?: string; item?: string };
};
const PartContext = createContext<AgentsPart | null>(null);

/**
 * The Agents page with nothing picked: profiles, model profiles, harnesses,
 * tools and your other devices, one section each, like the Settings page.
 * Each row opens its detail; the programs found on this computer wait at
 * the end of the list they join. On this computer, "Set up an agent"
 * installs one and signs it in.
 */
export function AgentsOverview({
	agentProfiles,
	modelProfiles,
	harnesses,
	cliTools,
	connections,
	otherDevices,
	deciderLabel,
	onSelect,
	onAddHarness,
	onAddTool,
	part,
	heading,
	after,
}: {
	part?: AgentsPart;
	/** The heading of the page, in place of "Agents". */
	heading?: ReactNode;
	/** More sections, after the lists. */
	after?: ReactNode;
	agentProfiles: AgentProfileRow[];
	modelProfiles: ModelProfileRow[];
	/** The harnesses that are added. */
	harnesses: HarnessRow[];
	cliTools: CliTool[];
	connections: Connection[];
	otherDevices: OtherDevice[];
	deciderLabel: (name: string) => string;
	onSelect: (selection: Selection) => void;
	onAddHarness: () => void;
	onAddTool: () => void;
}) {
	const found = useFoundPrograms(onSelect);
	const setup = useAgentSetupStatus();
	const canSetUp =
		setup.data?.available === true && setup.data.agents.length > 0;
	const [settingUp, setSettingUp] = useState(false);
	const setUpButton = (
		<Button variant="outline" size="sm" onClick={() => setSettingUp(true)}>
			<DownloadIcon data-icon="inline-start" />
			Set up an agent
		</Button>
	);

	const shows = (name: AgentsPart["only"]) => !part || part.only === name;
	return (
		<PartContext value={part ?? null}>
			<div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 p-4 md:p-6">
				{heading ?? (
					<PageHeading
						title="Agents"
						description="Give Agent nodes a harness, a model and tools under one name. When you change a profile, every flow that uses it changes too."
					/>
				)}
				{shows("profiles") ? (
					<Part
						title="Profiles"
						description="Agent nodes pick a profile by its name."
						actions={
							<AddButton onClick={() => onSelect({ kind: "new-profile" })}>
								Add profile
							</AddButton>
						}
					>
						{agentProfiles.length === 0 ? (
							<Empty className="border">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<BotIcon />
									</EmptyMedia>
									<EmptyTitle>No profiles yet</EmptyTitle>
									<EmptyDescription>
										{canSetUp
											? "Night Shift installs an agent for you and adds its profile."
											: "Add a profile, or add an agent from this computer under Harnesses."}
									</EmptyDescription>
								</EmptyHeader>
								{canSetUp ? <EmptyContent>{setUpButton}</EmptyContent> : null}
							</Empty>
						) : (
							<ListTable first="Profile" second="Runs on">
								{agentProfiles.map((profile) => (
									<OpenRow
										key={profile.id}
										to={{ kind: "profile", id: profile.id }}
										title={<span className="font-mono">{profile.name}</span>}
										middle={profileSummary(profile)}
										aside={<UsedIn usedBy={profile.usedBy} />}
									/>
								))}
							</ListTable>
						)}
					</Part>
				) : null}

				{shows("models") ? (
					<Part
						title="Model profiles"
						description="Decision and Value nodes pick one when a model decides."
						actions={
							<AddButton
								onClick={() => onSelect({ kind: "new-model-profile" })}
							>
								Add model profile
							</AddButton>
						}
					>
						{modelProfiles.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								No model profiles yet.
							</p>
						) : (
							<ListTable first="Model profile" second="Answers with">
								{modelProfiles.map((profile) => (
									<OpenRow
										key={profile.id}
										to={{ kind: "profile", id: profile.id }}
										title={<span className="font-mono">{profile.name}</span>}
										middle={`${deciderLabel(profile.decider)} · ${profile.model ?? "default model"}`}
										aside={<UsedIn usedBy={profile.usedBy} />}
									/>
								))}
							</ListTable>
						)}
					</Part>
				) : null}

				{shows("harnesses") ? (
					<Part
						title="Harnesses"
						description="The agents a profile runs on."
						actions={
							<>
								{canSetUp ? setUpButton : null}
								<AddButton onClick={onAddHarness}>Add harness</AddButton>
							</>
						}
					>
						{harnesses.length === 0 && found.agents.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								No harnesses yet. Add one, such as Claude Code or Codex.
							</p>
						) : (
							<ListTable first="Harness" second="Kind">
								{harnesses.map((harness) => (
									<OpenRow
										key={harness.name}
										to={{ kind: "harness", name: harness.name }}
										title={harness.label}
										middle={harness.custom ? "Custom agent" : "Agent"}
										aside={<CliCheckBadge target={harness.name} />}
									/>
								))}
								{found.agents.map(found.row)}
							</ListTable>
						)}
					</Part>
				) : null}

				{shows("tools") ? (
					<Part
						title="Tools"
						description="The CLIs and MCP servers a profile gives its agent."
						actions={<AddButton onClick={onAddTool}>Add tool</AddButton>}
					>
						{cliTools.length === 0 &&
						connections.length === 0 &&
						found.tools.length === 0 ? (
							<p className="text-muted-foreground text-sm">
								No tools yet. Add a CLI, such as gh, or an MCP server.
							</p>
						) : (
							<ListTable first="Tool" second="Kind">
								{cliTools.map((tool) => (
									<OpenRow
										key={`cli:${tool.name}`}
										to={{ kind: "cli", name: tool.name }}
										title={<span className="font-mono">{tool.name}</span>}
										line={tool.description ?? undefined}
										middle="CLI"
										aside={<CliToolCheckBadge tool={tool} />}
									/>
								))}
								{connections.map((connection) => (
									<OpenRow
										key={connection.name}
										to={{ kind: "tool", name: connection.name }}
										title={<span className="font-mono">{connection.name}</span>}
										line={connection.description ?? undefined}
										middle="MCP server"
										aside={
											connection.variables.some(
												(v) => v.source === "missing",
											) ? (
												<Badge
													variant="outline"
													className="text-status-waiting"
												>
													Secret missing
												</Badge>
											) : null
										}
									/>
								))}
								{found.tools.map(found.row)}
							</ListTable>
						)}
					</Part>
				) : null}

				{otherDevices.length > 0 && shows("profiles") ? (
					<PageSection
						title="On your other devices"
						description="You can only look at these. Change them on that device."
					>
						<ListTable first="Device" second="Has">
							{otherDevices.map((device) => (
								<OpenRow
									key={device.id}
									to={{ kind: "device", id: device.id }}
									title={device.name}
									middle={deviceSummary(device)}
								/>
							))}
						</ListTable>
					</PageSection>
				) : null}
				{after}
				{canSetUp ? (
					<AgentSetupDialog open={settingUp} onOpenChange={setSettingUp} />
				) : null}
			</div>
		</PartContext>
	);
}

/**
 * One list of the page. On the Agents page it is a section with a title. As
 * a page of its own in Settings, the page heading is its title, and its
 * actions go to the site header.
 */
function Part({
	title,
	description,
	actions,
	children,
}: {
	title: string;
	description: string;
	actions: ReactNode;
	children: ReactNode;
}) {
	const part = useContext(PartContext);
	if (part) {
		return (
			<>
				<HeaderActions>{actions}</HeaderActions>
				{children}
			</>
		);
	}
	return (
		<PageSection title={title} description={description} actions={actions}>
			{children}
		</PageSection>
	);
}

function AddButton({
	onClick,
	children,
}: {
	onClick: () => void;
	children: ReactNode;
}) {
	// In the site header it is the main action of the page.
	const part = useContext(PartContext);
	return (
		<Button variant={part ? "default" : "outline"} size="sm" onClick={onClick}>
			<PlusIcon data-icon="inline-start" />
			{children}
		</Button>
	);
}

/** The frame of a list: the same table as Night Shift's agents. */
function ListTable({
	first,
	second,
	children,
}: {
	first: string;
	second: string;
	children: ReactNode;
}) {
	return (
		<div className="overflow-x-auto rounded-xl border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-72 px-3">{first}</TableHead>
						<TableHead className="px-3">{second}</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>{children}</TableBody>
			</Table>
		</div>
	);
}

/** A row that opens its detail: its name is a link, so it opens in a new tab too. */
function OpenRow({
	to,
	title,
	line,
	middle,
	aside,
}: {
	to: Selection;
	title: ReactNode;
	/** One line under the name. */
	line?: ReactNode;
	middle?: ReactNode;
	aside?: ReactNode;
}) {
	const part = useContext(PartContext);
	const className = "font-medium underline-offset-4 hover:underline";
	return (
		<TableRow>
			<TableCell className="max-w-72 px-3 py-2.5">
				{part ? (
					<Link
						to="/settings"
						search={part.search(itemOf(to))}
						className={className}
					>
						{title}
					</Link>
				) : (
					<Link
						to="/agents"
						search={{ item: itemOf(to) }}
						className={className}
					>
						{title}
					</Link>
				)}
				{line ? (
					<div className="truncate text-muted-foreground text-xs">{line}</div>
				) : null}
			</TableCell>
			<TableCell className="px-3 py-2.5 text-muted-foreground">
				{middle}
			</TableCell>
			<TableCell className="px-3 py-2.5 text-right">{aside}</TableCell>
		</TableRow>
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

/** A mode other than auto, short, so two profiles that differ only in it do not look the same. */
const MODE_NOTES: Partial<
	Record<NonNullable<AgentProfileRow["permissionMode"]>, string>
> = {
	plan: "plan only",
	acceptEdits: "accepts edits",
	default: "asks for each tool",
	bypassPermissions: "bypasses permissions",
};

function profileSummary(profile: AgentProfileRow): string {
	return [
		harnessInfo(profile.harness).label,
		profile.model,
		profile.effort,
		profile.permissionMode && MODE_NOTES[profile.permissionMode],
	]
		.filter(Boolean)
		.join(" · ");
}

/** What a row says of another device: how many profiles and secrets it has. */
function deviceSummary(device: OtherDevice): string {
	const profiles = device.profiles.length;
	const secrets = device.secrets.length;
	return `${profiles} ${profiles === 1 ? "profile" : "profiles"} · ${secrets} ${secrets === 1 ? "secret" : "secrets"}`;
}
