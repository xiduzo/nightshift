import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Empty,
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
import { BotIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
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

/**
 * The Agents page with nothing picked: profiles, model profiles, harnesses,
 * tools and your other devices, one section each, like the Settings page.
 * Each row opens its detail; the programs found on this computer wait at
 * the end of the list they join.
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
}: {
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

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="mx-auto w-full max-w-4xl">
				<PageHeading
					title="Agents"
					description="Give Agent nodes a harness, a model and tools under one name. Change a profile here and every flow that uses it follows."
				/>
			</div>

			<div className="mx-auto flex w-full max-w-4xl flex-col gap-10">
				<PageSection
					title="Profiles"
					description="Agent nodes pick one by its name."
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
									Add a profile, or set up an agent this computer has under
									Harnesses.
								</EmptyDescription>
							</EmptyHeader>
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

				<PageSection
					title="Model profiles"
					description="Decision and Value nodes that a model decides pick one by its name."
					actions={
						<AddButton onClick={() => onSelect({ kind: "new-model-profile" })}>
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

				<PageSection
					title="Harnesses"
					description="The coding agents a profile runs on."
					actions={<AddButton onClick={onAddHarness}>Add harness</AddButton>}
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
								aside={<CliToolCheckBadge name={tool.name} />}
							/>
						))}
						{connections.map((connection) => (
							<OpenItem
								key={connection.name}
								to={{ kind: "tool", name: connection.name }}
								title={<span className="font-mono">{connection.name}</span>}
								description="MCP server"
								aside={
									connection.variables.some((v) => v.source === "missing") ? (
										<Badge variant="outline" className="text-status-waiting">
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

				{otherDevices.length > 0 ? (
					<PageSection
						title="On your other devices"
						description="Their profiles, read-only. You change them on that device."
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
		</div>
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
	return (
		<Item
			variant="outline"
			size="sm"
			render={<Link to="/agents" search={{ item: itemOf(to) }} />}
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

function profileSummary(profile: AgentProfileRow): string {
	return [harnessInfo(profile.harness).label, profile.model, profile.effort]
		.filter(Boolean)
		.join(" · ");
}

/** What a row says of another device: how many profiles and secrets it has. */
function deviceSummary(device: OtherDevice): string {
	const profiles = device.profiles.length;
	const secrets = device.secrets.length;
	return `${profiles} ${profiles === 1 ? "profile" : "profiles"} · ${secrets} ${secrets === 1 ? "secret" : "secrets"}`;
}
