/** The detail of the Agents page: the profile, harness, tool or device you picked. */
import type { CustomAgent } from "@nightshift/flows";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import { CircleHelpIcon, SquareTerminalIcon } from "lucide-react";
import type {
	CliTool,
	Connection,
	ConnectionList,
	HarnessRow,
	OtherDevice,
	ProfileRow,
	SettingsView,
} from "@/shared/api";
import { itemOf, type Selection } from "./agents-selection";
import { CliToolDetail } from "./cli-tool";
import { CustomAgentDetail } from "./custom-agent";
import { HarnessDetail } from "./harness-detail";
import {
	ModelProfileDetail,
	newModelProfileDraft,
} from "./model-profile-detail";
import { OtherDeviceDetail } from "./other-device";
import { newProfileDraft, ProfileDetail } from "./profile-detail";
import { ToolDetail } from "./tool-detail";

type PageData = {
	profiles: ProfileRow[];
	harnesses: HarnessRow[];
	connections: ConnectionList["connections"];
	cliTools: CliTool[];
	settings: SettingsView | undefined;
	/** Your other devices, read-only here. */
	otherDevices: OtherDevice[];
};

export function Detail({
	selection,
	onSelect,
	onGo,
	onDirtyChange,
	onEditTool,
	onEditCliTool,
	onEditAgent,
	onOpenSecrets,
	data,
}: {
	selection: Selection;
	/** Asks first when the profile form has unsaved changes. */
	onSelect: (selection: Selection | null) => void;
	/** Goes at once: after a save, a delete or a cancel. */
	onGo: (selection: Selection | null) => void;
	onDirtyChange: (dirty: boolean) => void;
	onEditTool: (connection: Connection) => void;
	onEditCliTool: (tool: CliTool) => void;
	onEditAgent: (agent: CustomAgent) => void;
	onOpenSecrets: () => void;
	data: PageData;
}) {
	const added = data.harnesses.filter((h) => h.added);
	// The tools and harnesses list the profiles that use them by name.
	const openProfile = (name: string) => {
		const found = data.profiles.find((p) => p.name === name);
		if (found) onSelect({ kind: "profile", id: found.id });
	};

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
					onSaved={(id) => onGo({ kind: "profile", id })}
					onDeleted={() => onGo(null)}
					onCancelNew={() => onGo(null)}
					onDirtyChange={onDirtyChange}
				/>
			);
		case "profile":
		case "new-profile": {
			const found =
				selection.kind === "profile"
					? data.profiles.find((p) => p.id === selection.id)
					: null;
			if (found === undefined) return <Gone what="profile" />;
			if (found && !("harness" in found)) {
				return (
					<ModelProfileDetail
						key={itemOf(selection)}
						profile={found}
						initial={newModelProfileDraft(found.decider)}
						profiles={data.profiles}
						onSaved={(id) => onGo({ kind: "profile", id })}
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
								A profile runs on a harness, such as Claude Code or Codex. Go
								back to Agents and choose Add harness.
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
					onSaved={(id) => onGo({ kind: "profile", id })}
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
					onOpenSecrets={onOpenSecrets}
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
		case "device": {
			const device = data.otherDevices.find((d) => d.id === selection.id);
			if (!device) return <Gone what="device" />;
			return <OtherDeviceDetail key={device.id} device={device} />;
		}
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
					It was removed or renamed. Go back to Agents and pick another one.
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
