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
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	ChevronRightIcon,
	DownloadIcon,
	PlusIcon,
} from "lucide-react";
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
import { PageHeading, PageSection } from "@/shared/page";
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
}: {
	part?: AgentsPart;
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
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className={part ? "hidden" : "mx-auto w-full max-w-4xl"}>
					<PageHeading
						title="Agents"
						description="Give Agent nodes a harness, a model and tools under one name. When you change a profile, every flow that uses it changes too."
					/>
				</div>

				<div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
					{shows("profiles") ? (
						<PageSection
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
								<ItemGroup className="gap-2">
									{agentProfiles.map((profile) => (
										<OpenItem
											key={profile.id}
											to={{ kind: "profile", id: profile.id }}
											title={<span className="font-mono">{profile.name}</span>}
											description={profileSummary(profile)}
											aside={<UsedIn usedBy={profile.usedBy} />}
										/>
									))}
								</ItemGroup>
							)}
						</PageSection>
					) : null}

					{shows("models") ? (
						<PageSection
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
								<ItemGroup className="gap-2">
									{modelProfiles.map((profile) => (
										<OpenItem
											key={profile.id}
											to={{ kind: "profile", id: profile.id }}
											title={<span className="font-mono">{profile.name}</span>}
											description={`${deciderLabel(profile.decider)} · ${profile.model ?? "default model"}`}
											aside={<UsedIn usedBy={profile.usedBy} />}
										/>
									))}
								</ItemGroup>
							)}
						</PageSection>
					) : null}

					{shows("harnesses") ? (
						<PageSection
							title="Harnesses"
							description="The agents a profile runs on."
							actions={
								<>
									{canSetUp ? setUpButton : null}
									<AddButton onClick={onAddHarness}>Add harness</AddButton>
								</>
							}
						>
							<ItemGroup className="gap-2">
								{harnesses.map((harness) => (
									<OpenItem
										key={harness.name}
										to={{ kind: "harness", name: harness.name }}
										title={harness.label}
										description={harness.custom ? "Custom agent" : undefined}
										aside={<CliCheckBadge target={harness.name} />}
									/>
								))}
								{found.agents.map(found.row)}
								{harnesses.length === 0 && found.agents.length === 0 ? (
									<p className="text-muted-foreground text-sm">
										No harnesses yet. Add one, such as Claude Code or Codex.
									</p>
								) : null}
							</ItemGroup>
						</PageSection>
					) : null}

					{shows("tools") ? (
						<PageSection
							title="Tools"
							description="The CLIs and MCP servers a profile gives its agent."
							actions={<AddButton onClick={onAddTool}>Add tool</AddButton>}
						>
							<ItemGroup className="gap-2">
								{cliTools.map((tool) => (
									<OpenItem
										key={`cli:${tool.name}`}
										to={{ kind: "cli", name: tool.name }}
										title={<span className="font-mono">{tool.name}</span>}
										description="CLI"
										aside={<CliToolCheckBadge tool={tool} />}
									/>
								))}
								{connections.map((connection) => (
									<OpenItem
										key={connection.name}
										to={{ kind: "tool", name: connection.name }}
										title={<span className="font-mono">{connection.name}</span>}
										description="MCP server"
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
								{cliTools.length === 0 &&
								connections.length === 0 &&
								found.tools.length === 0 ? (
									<p className="text-muted-foreground text-sm">
										No tools yet. Add a CLI, such as gh, or an MCP server.
									</p>
								) : null}
							</ItemGroup>
						</PageSection>
					) : null}

					{otherDevices.length > 0 && shows("profiles") ? (
						<PageSection
							title="On your other devices"
							description="You can only look at these. Change them on that device."
						>
							<ItemGroup className="gap-2">
								{otherDevices.map((device) => (
									<OpenItem
										key={device.id}
										to={{ kind: "device", id: device.id }}
										title={device.name}
										description={deviceSummary(device)}
									/>
								))}
							</ItemGroup>
						</PageSection>
					) : null}
				</div>
				{canSetUp ? (
					<AgentSetupDialog open={settingUp} onOpenChange={setSettingUp} />
				) : null}
			</div>
		</PartContext>
	);
}

function AddButton({
	onClick,
	children,
}: {
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Button variant="outline" size="sm" onClick={onClick}>
			<PlusIcon data-icon="inline-start" />
			{children}
		</Button>
	);
}

/** A row that opens its detail: a link, so it hovers and opens in a new tab. */
function OpenItem({
	to,
	title,
	description,
	aside,
}: {
	to: Selection;
	title: ReactNode;
	description?: ReactNode;
	aside?: ReactNode;
}) {
	const part = useContext(PartContext);
	return (
		<Item
			variant="outline"
			size="sm"
			render={
				part ? (
					<Link to="/settings" search={part.search(itemOf(to))} />
				) : (
					<Link to="/agents" search={{ item: itemOf(to) }} />
				)
			}
		>
			<ItemContent>
				<ItemTitle>{title}</ItemTitle>
				{description ? <ItemDescription>{description}</ItemDescription> : null}
			</ItemContent>
			<ItemActions>
				{aside}
				<ChevronRightIcon className="size-4 text-muted-foreground" />
			</ItemActions>
		</Item>
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
