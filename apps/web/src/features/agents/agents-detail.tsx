/** The right side of the Agents page: the profile, harness, connection or tool you picked. */
import type { CustomAgent } from "@nightshift/flows";
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
	BotIcon,
	CircleHelpIcon,
	PlusIcon,
	SquareTerminalIcon,
} from "lucide-react";
import type {
	CliTool,
	Connection,
	ConnectionList,
	HarnessRow,
	ProfileRow,
	SecretView,
	SettingsView,
} from "@/shared/api";
import { itemOf, type Selection } from "./agents-selection";
import { CliToolDetail } from "./cli-tool";
import { SecretsCard } from "./connections/secrets-card";
import { CustomAgentDetail } from "./custom-agent";
import { HarnessDetail } from "./harness-detail";
import {
	ModelProfileDetail,
	newModelProfileDraft,
} from "./model-profile-detail";
import { newProfileDraft, ProfileDetail } from "./profile-detail";
import { ToolDetail } from "./tool-detail";

type PageData = {
	profiles: ProfileRow[];
	harnesses: HarnessRow[];
	connections: ConnectionList["connections"];
	cliTools: CliTool[];
	secrets: SecretView[];
	settings: SettingsView | undefined;
};

export function Detail({
	selection,
	onSelect,
	onGo,
	onDirtyChange,
	onEditTool,
	onEditCliTool,
	onEditAgent,
	data,
}: {
	selection: Selection | null;
	/** Asks first when the profile form has unsaved changes. */
	onSelect: (selection: Selection | null) => void;
	/** Goes at once: after a save, a delete or a cancel. */
	onGo: (selection: Selection | null) => void;
	onDirtyChange: (dirty: boolean) => void;
	onEditTool: (connection: Connection) => void;
	onEditCliTool: (tool: CliTool) => void;
	onEditAgent: (agent: CustomAgent) => void;
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
					<EmptyTitle>No profiles yet</EmptyTitle>
					<EmptyDescription>
						A profile gives a harness, a model and tools one name for Agent
						nodes. A model profile picks the model for Decision and Value nodes.
						One change here reaches every flow.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent className="flex-row justify-center">
					<Button size="sm" onClick={() => onSelect({ kind: "new-profile" })}>
						<PlusIcon data-icon="inline-start" />
						Add a profile
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() => onSelect({ kind: "new-model-profile" })}
					>
						<PlusIcon data-icon="inline-start" />
						Add a model profile
					</Button>
				</EmptyContent>
			</Empty>
		);
	}

	switch (selection.kind) {
		case "new-model-profile":
			return (
				<ModelProfileDetail
					key={itemOf(selection)}
					profile={null}
					initial={newModelProfileDraft(
						data.settings?.values.decisionDecider ?? "typesafe",
					)}
					profiles={data.profiles}
					onSaved={(name) => onGo({ kind: "profile", name })}
					onDeleted={() => onGo(null)}
					onCancelNew={() => onGo(null)}
					onDirtyChange={onDirtyChange}
				/>
			);
		case "profile":
		case "new-profile": {
			const found =
				selection.kind === "profile"
					? data.profiles.find((p) => p.name === selection.name)
					: null;
			if (found === undefined) return <Gone what="profile" />;
			if (found && !("harness" in found)) {
				return (
					<ModelProfileDetail
						key={itemOf(selection)}
						profile={found}
						initial={newModelProfileDraft(found.decider)}
						profiles={data.profiles}
						onSaved={(name) => onGo({ kind: "profile", name })}
						onDeleted={() => onGo(null)}
						onCancelNew={() => onGo(null)}
						onDirtyChange={onDirtyChange}
					/>
				);
			}
			const profile = found;
			if (added.length === 0) {
				return (
					<Empty className="h-full">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<SquareTerminalIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>Add a harness first</EmptyTitle>
							<EmptyDescription>
								A profile runs on a harness, such as Claude Code or Codex. Add
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
					cliTools={data.cliTools}
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
			if (harness.custom) {
				const agent = harness.custom;
				return (
					<CustomAgentDetail
						key={harness.name}
						harness={harness}
						agent={agent}
						onEdit={() => onEditAgent(agent)}
						onOpenProfile={openProfile}
						onRemoved={() => onGo(null)}
					/>
				);
			}
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
		case "cli": {
			const tool = data.cliTools.find((t) => t.name === selection.name);
			if (!tool) return <Gone what="tool" />;
			return (
				<CliToolDetail
					key={tool.name}
					tool={tool}
					onEdit={() => onEditCliTool(tool)}
					onOpenProfile={openProfile}
					onRemoved={() => onGo(null)}
				/>
			);
		}
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
				<EmptyMedia variant="icon">
					<CircleHelpIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>No such {what}</EmptyTitle>
				<EmptyDescription>
					It was removed or renamed. Pick another one on the left.
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
