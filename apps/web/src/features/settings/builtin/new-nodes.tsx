/**
 * What a new node starts with: the agent of a new Agent node and the
 * decider of a new Decision node. Each is a row with the agent picker,
 * and a pick saves at once. This is the one place of these settings.
 */
import { isCustomHarness } from "@nightshift/flows";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { InputGroupButton } from "@nightshift/ui/components/input-group";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import {
	deciderQueries,
	harnessInfo,
	harnessQueries,
	profileQueries,
} from "@/features/agents";
import type { SettingsView } from "@/shared/api";
import type { SettingKey } from "../form";
import {
	type AgentPicker,
	AnswersTable,
	PickerFrame,
	State,
	useModelOptions,
	useSaveNow,
} from "./answers-table";
import { deciderOfValue, deciderValue } from "./builtin-answer";
import { PERMISSION_MODES } from "./permission-modes";

/** The settings of the New nodes table. */
export const NEW_NODE_KEYS = [
	"agentHarness",
	"agentModel",
	"agentPermissionMode",
	"decisionDecider",
] as const satisfies readonly SettingKey[];

/** What a new Agent node starts with: the harness and the model of the settings. */
function NewAgentPicker({
	data,
	agentPicker,
}: {
	data: SettingsView;
	agentPicker: AgentPicker;
}) {
	const saveNow = useSaveNow();
	const profiles = useQuery(profileQueries.agents());
	return (
		<PickerFrame>
			{agentPicker({
				purpose: "run",
				// A new node keeps a harness and a model, no effort.
				effort: false,
				choice: {
					harness: data.values.agentHarness,
					model: data.values.agentModel,
				},
				onChoiceChange: (choice) => {
					// A profile gives the harness and the model it has now.
					const profile = profiles.data?.find((p) => p.name === choice.profile);
					const harness = choice.harness ?? profile?.harness;
					if (!harness) return;
					if (isCustomHarness(harness)) {
						toast.error(
							"A new Agent node cannot start on a custom agent. Choose another harness.",
						);
						return;
					}
					saveNow({
						agentHarness: harness,
						agentModel:
							choice.model?.trim() ||
							(harness === profile?.harness ? profile.model : "") ||
							harnessInfo(harness).defaultModel,
					});
				},
			})}
			<NewAgentPermission data={data} />
		</PickerFrame>
	);
}

/** What a new Agent node may do without you: its permission mode, a second menu. */
function NewAgentPermission({ data }: { data: SettingsView }) {
	const saveNow = useSaveNow();
	const value = data.values.agentPermissionMode;
	const mode = PERMISSION_MODES.find((option) => option.value === value);
	const risky = value === "bypassPermissions";
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<InputGroupButton
						className="shrink-0 font-normal text-muted-foreground"
						aria-label={`Permission mode: ${mode?.label ?? value}. Choose what the agent may do.`}
						title="Choose what the agent may do without you"
					>
						{risky ? (
							<TriangleAlertIcon className="text-status-waiting" />
						) : null}
						{mode?.label ?? value}
						<ChevronDownIcon />
					</InputGroupButton>
				}
			/>
			<DropdownMenuContent align="start" className="w-80">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Permission mode</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={value}
						onValueChange={(next: string) =>
							saveNow({ agentPermissionMode: next as typeof value })
						}
					>
						{PERMISSION_MODES.map((option) => (
							<DropdownMenuRadioItem
								key={option.value}
								value={option.value}
								closeOnClick
								className="items-start"
							>
								<span className="flex min-w-0 flex-1 flex-col">
									<span>{option.label}</span>
									<span className="text-xs text-muted-foreground">
										{option.description}
									</span>
								</span>
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** Whether a new Agent node can run: its harness is one of yours. */
function NewAgentState({ data }: { data: SettingsView }) {
	const harnesses = useQuery(harnessQueries.list());
	if (!harnesses.data) return <Skeleton className="ml-auto h-5 w-16" />;
	const name = data.values.agentHarness;
	const added = harnesses.data.some((h) => h.name === name && h.added);
	return (
		<State
			problem={added ? null : "Harness not added"}
			detail={`${harnessInfo(name).label} is not one of your harnesses. Add it under Your harnesses, or choose another one.`}
		/>
	);
}

/** The model a new Decision node uses to choose: a decider of this computer. */
function NewDecisionPicker({
	data,
	agentPicker,
}: {
	data: SettingsView;
	agentPicker: AgentPicker;
}) {
	const saveNow = useSaveNow();
	const options = useModelOptions().filter(
		(option) => deciderOfValue(option.value) !== undefined,
	);
	return (
		<PickerFrame>
			{agentPicker({
				purpose: "run",
				agents: false,
				choice: {},
				onChoiceChange: () => {},
				models: {
					label: "Deciders",
					options,
					value: deciderValue(data.values.decisionDecider),
					onPick: (value) => {
						const decider = value ? deciderOfValue(value) : undefined;
						if (decider) saveNow({ decisionDecider: decider });
					},
				},
			})}
		</PickerFrame>
	);
}

/** Whether the decider of a new Decision node can answer: its secret is saved. */
function NewDecisionState({ data }: { data: SettingsView }) {
	const deciders = useQuery(deciderQueries.list());
	if (!deciders.data) return <Skeleton className="ml-auto h-5 w-16" />;
	const decider = deciders.data.find(
		(d) => d.name === data.values.decisionDecider,
	);
	const missing = decider?.apiKeySource === "missing" && decider.apiKey;
	return (
		<State
			problem={missing ? "Needs a secret" : null}
			detail={
				missing ? `Save the secret ${missing} on the Secrets page.` : undefined
			}
		/>
	);
}

/**
 * What the Decision row says. Until the person chooses a decider, the
 * default follows the TypeSafe key: TypeSafe Jev with it, Ollama without it.
 */
function deciderNote(data: SettingsView): string {
	const what = "The model a new Decision uses to choose.";
	if (data.fields.decisionDecider.source === "saved") return what;
	return data.values.decisionDecider === "typesafe"
		? `${what} Your TypeSafe key makes TypeSafe Jev the default.`
		: `${what} Without a TypeSafe key, the default is Ollama on this computer.`;
}

/** What a new node starts with. Existing nodes keep their values. */
export function NewNodesTable({
	data,
	agentPicker,
}: {
	data: SettingsView;
	agentPicker: AgentPicker;
}) {
	return (
		<AnswersTable
			first="Node"
			rows={[
				{
					key: "new-agent",
					name: "A new Agent node",
					job: "The agent a new Agent node starts with, and what it may do.",
					answersWith: <NewAgentPicker data={data} agentPicker={agentPicker} />,
					state: <NewAgentState data={data} />,
				},
				{
					key: "new-decision",
					name: "A new Decision node",
					job: deciderNote(data),
					answersWith: (
						<NewDecisionPicker data={data} agentPicker={agentPicker} />
					),
					state: <NewDecisionState data={data} />,
				},
			]}
		/>
	);
}
