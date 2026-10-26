/** The fields of an Agent node: its profile, harness, model, prompt and task. */
import type { AgentNode, Flow, NodeOption } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { SlashSquareIcon, TextIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import {
	EFFORTS,
	HARNESSES,
	type HarnessName,
	harnessInfo,
	ModelCombobox,
	PERMISSION_MODES,
	permissionLabel,
	profileQueries,
	switchHarness,
	useCustomAgents,
} from "@/features/agents";
import type { Effort, PermissionMode, ProfileRow } from "@/shared/api";
import { Field, InspectorSection } from "../fields";
import { SkillCombobox } from "../skill-combobox";
import { TemplateField } from "../template-field";
import { AgentOutcomeSection } from "./agent-outcomes";
import { withoutField } from "./model-defaults";

/**
 * The node on another profile, or on none. Picking a profile hands it the
 * harness, model, effort and permission mode (the node's own go); picking
 * none keeps what the old profile gave, so the node runs as before.
 */
function pickProfile(
	node: AgentNode,
	next: ProfileRow | undefined,
	before: ProfileRow | undefined,
): AgentNode {
	const {
		profile: _profile,
		harness,
		model,
		effort,
		permissionMode,
		...rest
	} = node;
	if (next) return { ...rest, profile: next.name };
	const kept: AgentNode = {
		...rest,
		harness: harness ?? before?.harness ?? "claude-code",
		model: model ?? before?.model ?? harnessInfo("claude-code").defaultModel,
		permissionMode: permissionMode ?? before?.permissionMode ?? "auto",
	};
	const keptEffort = effort ?? before?.effort;
	if (keptEffort !== undefined) kept.effort = keptEffort;
	return kept;
}

export function useProfile(node: AgentNode) {
	const profiles = useQuery({
		...profileQueries.list(),
		staleTime: 30_000,
		meta: { quietErrors: true },
	});
	const profile =
		node.profile === undefined
			? undefined
			: profiles.data?.find((p) => p.name === node.profile);
	const unknownProfile =
		node.profile !== undefined && profiles.data !== undefined && !profile;
	return { profiles: profiles.data, profile, unknownProfile };
}

/** How an Agent node gets its task, in the order the toggle shows them. */
const TASK_KINDS = [
	{ value: "prompt", label: "Prompt", icon: TextIcon },
	{ value: "skill", label: "Skill", icon: SlashSquareIcon },
] as const;

export function AgentFields({
	projectId,
	flow,
	node,
	onChange,
	onRenameOutcome,
	onRemoveOutcome,
	onSetOutcomes,
}: {
	projectId: string;
	flow: Flow;
	node: AgentNode;
	onChange: (change: (node: AgentNode) => AgentNode) => void;
	onRenameOutcome: (index: number, name: string) => string | null;
	onRemoveOutcome: (index: number) => void;
	onSetOutcomes: (outcomes: NodeOption[] | undefined) => void;
}) {
	const id = useId();
	const { profiles, profile, unknownProfile } = useProfile(node);
	const customAgents = useCustomAgents();
	const info = (name: HarnessName) => harnessInfo(name, customAgents);
	// With a profile, a field the node leaves out comes from the profile.
	const harnessName: HarnessName =
		node.harness ?? profile?.harness ?? "claude-code";
	const harness = info(harnessName);
	// The built-in harnesses, the custom agents added here, and the node's
	// own custom agent when this computer has not added it.
	const harnessOptions = [
		...HARNESSES.map(({ value, label }) => ({ value, label })),
		...customAgents.map((agent) => info(`acp:${agent.slug}`)),
		...(node.harness?.startsWith("acp:") &&
		!customAgents.some((a) => `acp:${a.slug}` === node.harness)
			? [info(node.harness)]
			: []),
	];
	const fromProfile = (value: string) => `From the profile (${value})`;
	// A skill with no name yet is not in the node: keep the toggle on Skill.
	const [taskKind, setTaskKind] = useState<"prompt" | "skill">(
		node.skill === undefined ? "prompt" : "skill",
	);

	return (
		<>
			<InspectorSection title="Agent">
				<Field
					id={`${id}-profile`}
					label="Profile"
					hint={
						unknownProfile
							? `There is no profile named ${node.profile}. The flow cannot run until you pick another or add it under Agents.`
							: profile
								? "This node uses the profile. Change a field below to override it for this node only. Choose From the profile to undo."
								: "A saved agent setup from the Agents page. Without one, set the harness and model below."
					}
				>
					<NativeSelect
						id={`${id}-profile`}
						value={node.profile ?? ""}
						aria-describedby={`${id}-profile-hint`}
						aria-invalid={unknownProfile || undefined}
						onChange={(event) => {
							const name = event.target.value;
							const next = profiles?.find((p) => p.name === name);
							onChange((current) => pickProfile(current, next, profile));
						}}
					>
						<NativeSelectOption value="">
							None: set it on this node
						</NativeSelectOption>
						{(profiles ?? []).map((p) => (
							<NativeSelectOption key={p.name} value={p.name}>
								{p.name} · {info(p.harness).label} · {p.model}
							</NativeSelectOption>
						))}
						{unknownProfile ? (
							<NativeSelectOption value={node.profile}>
								{node.profile} (not found)
							</NativeSelectOption>
						) : null}
					</NativeSelect>
				</Field>

				<Field
					id={`${id}-harness`}
					label={
						<>
							Harness
							{node.profile !== undefined && node.harness !== undefined ? (
								<OverrideBadge />
							) : null}
						</>
					}
					hint={harness.note}
				>
					<NativeSelect
						id={`${id}-harness`}
						value={node.harness ?? ""}
						aria-describedby={`${id}-harness-hint`}
						onChange={(event) => {
							const next = event.target.value as HarnessName | "";
							onChange((current) =>
								next === ""
									? withoutField(current, "harness")
									: switchHarness(current, next, customAgents),
							);
						}}
					>
						{node.profile !== undefined ? (
							<NativeSelectOption value="">
								{fromProfile(profile ? info(profile.harness).label : "unknown")}
							</NativeSelectOption>
						) : null}
						{harnessOptions.map(({ value, label }) => (
							<NativeSelectOption key={value} value={value}>
								{label}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>

				<div className="grid grid-cols-2 gap-3">
					<Field
						id={`${id}-model`}
						label={
							<>
								Model
								{node.profile !== undefined && node.model !== undefined ? (
									<OverrideBadge />
								) : null}
							</>
						}
					>
						<ModelCombobox
							id={`${id}-model`}
							harness={harnessName}
							value={node.model ?? ""}
							placeholder={
								node.profile !== undefined
									? profile?.model
									: harness.defaultModel
							}
							invalid={node.profile === undefined && !node.model?.trim()}
							onChange={(model) =>
								onChange((current) =>
									model === "" && current.profile !== undefined
										? withoutField(current, "model")
										: { ...current, model },
								)
							}
						/>
					</Field>
					<Field
						id={`${id}-effort`}
						label={
							<>
								Effort
								{node.profile !== undefined && node.effort !== undefined ? (
									<OverrideBadge />
								) : null}
							</>
						}
					>
						<NativeSelect
							id={`${id}-effort`}
							value={node.effort ?? ""}
							onChange={(event) => {
								const effort = (event.target.value || undefined) as
									| Effort
									| undefined;
								onChange((current) =>
									effort === undefined
										? withoutField(current, "effort")
										: { ...current, effort },
								);
							}}
						>
							<NativeSelectOption value="">
								{profile
									? fromProfile(profile.effort ?? "model default")
									: "Model default"}
							</NativeSelectOption>
							{EFFORTS.map((value) => (
								<NativeSelectOption key={value} value={value}>
									{value}
								</NativeSelectOption>
							))}
						</NativeSelect>
					</Field>
				</div>

				<Field
					id={`${id}-permission`}
					label={
						<>
							Permission mode
							{node.profile !== undefined &&
							node.permissionMode !== undefined ? (
								<OverrideBadge />
							) : null}
						</>
					}
				>
					<NativeSelect
						id={`${id}-permission`}
						value={node.permissionMode ?? ""}
						aria-invalid={
							node.profile === undefined && node.permissionMode === undefined
								? true
								: undefined
						}
						onChange={(event) => {
							const permissionMode = event.target.value as PermissionMode | "";
							onChange((current) =>
								permissionMode === ""
									? withoutField(current, "permissionMode")
									: { ...current, permissionMode },
							);
						}}
					>
						{node.profile !== undefined ? (
							<NativeSelectOption value="">
								{fromProfile(
									profile ? permissionLabel(profile.permissionMode) : "unknown",
								)}
							</NativeSelectOption>
						) : node.permissionMode === undefined ? (
							<NativeSelectOption value="" disabled>
								Pick a permission mode
							</NativeSelectOption>
						) : null}
						{PERMISSION_MODES.map(({ value, label }) => (
							<NativeSelectOption key={value} value={value}>
								{label}
							</NativeSelectOption>
						))}
					</NativeSelect>
					{(node.permissionMode ?? profile?.permissionMode) ===
					"bypassPermissions" ? (
						<p className="flex items-start gap-1.5 text-status-waiting text-xs">
							<TriangleAlertIcon
								className="mt-px size-3.5 shrink-0"
								aria-hidden="true"
							/>
							The agent runs every tool, shell commands included, without
							asking.
						</p>
					) : null}
				</Field>

				<Field
					id={`${id}-session`}
					label="Session on a later visit"
					hint={
						node.session === "fresh"
							? "A retry starts over with only the task."
							: "A retry continues where the agent left off, with everything it knew."
					}
				>
					<NativeSelect
						id={`${id}-session`}
						value={node.session}
						aria-describedby={`${id}-session-hint`}
						onChange={(event) => {
							const session = event.target.value as AgentNode["session"];
							onChange((current) => ({ ...current, session }));
						}}
					>
						<NativeSelectOption value="fresh">Fresh session</NativeSelectOption>
						<NativeSelectOption value="resume">
							Resume the last session
						</NativeSelectOption>
					</NativeSelect>
				</Field>
			</InspectorSection>

			<InspectorSection title="Task">
				<Field
					id={`${id}-task`}
					label="The agent gets"
					hint={
						taskKind === "prompt"
							? "A prompt that you write."
							: `A skill that ${harness.label} already has, with optional arguments.`
					}
				>
					<ToggleGroup
						variant="outline"
						size="sm"
						spacing={0}
						aria-label="The agent gets"
						aria-describedby={`${id}-task-hint`}
						className="w-full"
						value={[taskKind]}
						onValueChange={(value) => {
							const next = value[0] as "prompt" | "skill" | undefined;
							if (!next) return;
							setTaskKind(next);
							if (next === "prompt") {
								onChange(({ skill: _, ...rest }) => rest);
							}
						}}
					>
						{TASK_KINDS.map((entry) => (
							<ToggleGroupItem
								key={entry.value}
								value={entry.value}
								className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
							>
								<entry.icon />
								{entry.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
				</Field>

				{taskKind === "prompt" ? (
					<TemplateField
						id={`${id}-prompt`}
						label="Prompt"
						hint="What the agent should do."
						flow={flow}
						nodeId={node.id}
						value={node.prompt}
						invalid={node.prompt.trim() === ""}
						placeholder="Implement the change, then report pass or fail."
						assist="prompt"
						onChange={(prompt) =>
							onChange((current) => ({ ...current, prompt }))
						}
					/>
				) : (
					<>
						<Field
							id={`${id}-skill`}
							label="Skill"
							hint="Pick a skill of this project or this computer, or type its name. Leave out the slash."
							error={node.skill === undefined ? "Write the skill name." : null}
						>
							<SkillCombobox
								id={`${id}-skill`}
								projectId={projectId}
								harness={harnessName}
								harnessLabel={harness.label}
								value={node.skill ?? ""}
								placeholder="wtf.implement-trace"
								invalid={node.skill === undefined}
								describedBy={`${id}-skill-hint`}
								onChange={(value) => {
									const skill = value.replace(/^\//, "").trim();
									onChange(({ skill: _, ...rest }) =>
										skill ? { ...rest, skill } : rest,
									);
								}}
							/>
						</Field>
						<TemplateField
							id={`${id}-arguments`}
							label="Arguments (optional)"
							hint={`The agent gets /${node.skill ?? "skill"} followed by this text.`}
							flow={flow}
							nodeId={node.id}
							value={node.prompt}
							className="min-h-16"
							placeholder="{{item.id}}"
							onChange={(prompt) =>
								onChange((current) => ({ ...current, prompt }))
							}
						/>
					</>
				)}
			</InspectorSection>

			<AgentOutcomeSection
				id={`${id}-outcomes`}
				node={node}
				flow={flow}
				onChange={onChange}
				onRenameOutcome={onRenameOutcome}
				onRemoveOutcome={onRemoveOutcome}
				onSetOutcomes={onSetOutcomes}
			/>
		</>
	);
}

/** Beside a field the node sets itself while it has a profile. */
function OverrideBadge() {
	return (
		<Badge variant="outline" className="h-4 px-1 text-[0.625rem]">
			This node
		</Badge>
	);
}
