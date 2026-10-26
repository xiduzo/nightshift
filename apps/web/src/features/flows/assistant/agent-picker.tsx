/**
 * Which agent answers: a compact button that shows the choice, and a
 * popover with the fields of an Agent node (profile, harness, model,
 * effort). The field helpers and the chat share the choice, and this
 * browser keeps it (`agent-choice.ts`).
 */
import { type AssistantAgent, harnessTakesTools } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@nightshift/ui/components/popover";
import { cn } from "@nightshift/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { BotIcon, ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useId } from "react";
import {
	EFFORTS,
	type HarnessName,
	harnessInfo,
	harnessQueries,
	ModelCombobox,
	profileQueries,
	useCustomAgents,
} from "@/features/agents";
import { settingsQueries } from "@/features/settings/queries";
import type { AgentProfileRow, Effort } from "@/shared/api";
import {
	type AgentChoice,
	currentAgentChoice,
	requestAgent,
	setAgentChoice,
	useAgentChoice,
} from "./agent-choice";

/** What the agent is for: the chat needs a harness that can use its tools. */
export type AgentPurpose = "suggest" | "chat";

/** The profile select's value for "None". Profile names cannot hold a colon. */
const NONE = ":none";

const quiet = { staleTime: 30_000, meta: { quietErrors: true } } as const;

/**
 * The profiles and harnesses of this computer, and the profile the
 * settings' "Profile for help" resolves to, as the daemon picks it: the
 * setting, else the first profile on a harness that is added. For the
 * chat, only one that can chat counts.
 */
function useAgentOptions(purpose: AgentPurpose) {
	const profiles = useQuery({ ...profileQueries.agents(), ...quiet });
	const harnesses = useQuery({ ...harnessQueries.list(), ...quiet });
	const settings = useQuery({ ...settingsQueries.get(), ...quiet });
	const customAgents = useCustomAgents();
	const added = (harnesses.data ?? []).filter((h) => h.added);
	const fits = (harness: HarnessName) =>
		purpose === "suggest" || harnessTakesTools(harness);
	const list = profiles.data ?? [];
	const setting = settings.data?.values.assistantProfile?.trim() ?? "";
	const fromSetting = list.find((p) => p.name === setting);
	const forHelp =
		fromSetting && fits(fromSetting.harness)
			? fromSetting
			: list.find(
					(p) => added.some((h) => h.name === p.harness) && fits(p.harness),
				);
	return {
		profiles: list,
		harnesses: added,
		forHelp,
		fits,
		info: (name: HarnessName) => harnessInfo(name, customAgents),
	};
}

/** The request fields of the choice now, for a request sent from a callback. */
export function agentRequest(): AssistantAgent {
	return requestAgent(
		currentAgentChoice(),
		(harness) => harnessInfo(harness).defaultModel,
	);
}

/** The button's words: "Profile for help", "worker · haiku", "Claude Code · haiku · low". */
function choiceLabel(
	choice: AgentChoice,
	info: (name: HarnessName) => { label: string },
): string {
	const parts =
		choice.profile !== undefined
			? [
					choice.profile,
					choice.harness ? info(choice.harness).label : null,
					choice.model,
				]
			: choice.harness !== undefined
				? [info(choice.harness).label, choice.model]
				: ["Profile for help"];
	return [...parts, choice.effort].filter(Boolean).join(" · ");
}

export function AgentPicker({
	purpose,
	className,
}: {
	purpose: AgentPurpose;
	className?: string;
}) {
	const choice = useAgentChoice();
	const options = useAgentOptions(purpose);
	const label = choiceLabel(choice, options.info);
	const refusal = chatRefusal(choice, purpose, options);
	return (
		<Popover>
			<PopoverTrigger
				render={
					<Button
						variant="ghost"
						size="xs"
						className={cn(
							"min-w-0 max-w-full justify-start font-normal text-muted-foreground",
							className,
						)}
						aria-label={`Agent: ${label}. Change the agent.`}
						title="Choose the agent that answers"
					>
						{refusal ? (
							<TriangleAlertIcon
								data-icon="inline-start"
								className="text-destructive"
							/>
						) : (
							<BotIcon data-icon="inline-start" />
						)}
						<span className="truncate">{label}</span>
						<ChevronDownIcon data-icon="inline-end" />
					</Button>
				}
			/>
			<PopoverContent
				align="start"
				className="w-[min(22rem,var(--available-width))] gap-3"
			>
				<PopoverHeader>
					<PopoverTitle>Agent</PopoverTitle>
					<PopoverDescription className="text-xs">
						The agent that answers here. It reads your project and changes
						nothing.
					</PopoverDescription>
				</PopoverHeader>
				<AgentFields
					choice={choice}
					purpose={purpose}
					options={options}
					refusal={refusal}
				/>
			</PopoverContent>
		</Popover>
	);
}

type Options = ReturnType<typeof useAgentOptions>;

/** The harness the choice runs on, when the page can tell. */
function harnessOf(
	choice: AgentChoice,
	profile: AgentProfileRow | undefined,
): HarnessName | undefined {
	return choice.harness ?? profile?.harness;
}

/** Why the chat cannot run on the choice, or null. */
function chatRefusal(
	choice: AgentChoice,
	purpose: AgentPurpose,
	options: Options,
): string | null {
	if (purpose !== "chat") return null;
	const profile =
		choice.profile !== undefined
			? options.profiles.find((p) => p.name === choice.profile)
			: choice.harness === undefined
				? options.forHelp
				: undefined;
	const harness = harnessOf(choice, profile);
	if (harness === undefined || options.fits(harness)) return null;
	return `${options.info(harness).label} cannot read your flow or propose changes. Choose Claude Code, Codex or OpenCode for the chat.`;
}

function AgentFields({
	choice,
	purpose,
	options,
	refusal,
}: {
	choice: AgentChoice;
	purpose: AgentPurpose;
	options: Options;
	refusal: string | null;
}) {
	const id = useId();
	const { profiles, harnesses, forHelp, fits, info } = options;
	const none = choice.profile === undefined && choice.harness !== undefined;
	const usesHelp = choice.profile === undefined && !none;
	// The profile the fields fall back to: the one picked, or the one for help.
	const profile = usesHelp
		? forHelp
		: profiles.find((p) => p.name === choice.profile);
	const harnessName: HarnessName =
		harnessOf(choice, profile) ?? harnesses[0]?.name ?? "claude-code";
	const harness = info(harnessName);
	const fromProfile = (value: string) => `From the profile (${value})`;
	// A change on the profile for help pins that profile, with the change on top.
	const change = (patch: Partial<AgentChoice>) => {
		const base: AgentChoice = usesHelp
			? forHelp
				? { profile: forHelp.name }
				: {}
			: { ...choice };
		const next: AgentChoice = { ...base, ...patch };
		for (const key of Object.keys(patch) as (keyof AgentChoice)[]) {
			if (patch[key] === undefined) delete next[key];
		}
		setAgentChoice(next);
	};
	const locked = usesHelp && !forHelp;
	const cannotChat = (name: HarnessName) =>
		purpose === "chat" && !fits(name) ? " (cannot chat)" : "";
	const harnessOptions = [
		...harnesses.map((h) => ({ value: h.name, label: info(h.name).label })),
		...(choice.harness && !harnesses.some((h) => h.name === choice.harness)
			? [
					{
						value: choice.harness,
						label: `${info(choice.harness).label} (not added)`,
					},
				]
			: []),
	];
	const unknownProfile =
		choice.profile !== undefined &&
		!profiles.some((p) => p.name === choice.profile);

	return (
		<FieldGroup className="gap-3">
			<Field>
				<FieldLabel htmlFor={`${id}-profile`}>Profile</FieldLabel>
				<NativeSelect
					id={`${id}-profile`}
					size="sm"
					className="w-full"
					value={usesHelp ? "" : none ? NONE : choice.profile}
					aria-invalid={unknownProfile || undefined}
					onChange={(event) => {
						const value = event.target.value;
						if (value === "") setAgentChoice({});
						else if (value === NONE) {
							// Keep what the profile gave, so the same agent answers.
							setAgentChoice({
								harness: harnessName,
								model: choice.model ?? profile?.model ?? harness.defaultModel,
								...((choice.effort ?? profile?.effort)
									? { effort: choice.effort ?? profile?.effort }
									: {}),
							});
						} else setAgentChoice({ profile: value });
					}}
				>
					<NativeSelectOption value="">
						{forHelp
							? `Profile for help (${forHelp.name})`
							: "Profile for help (none yet)"}
					</NativeSelectOption>
					<NativeSelectOption value={NONE}>
						None: choose the agent here
					</NativeSelectOption>
					{profiles.map((p) => (
						<NativeSelectOption
							key={p.name}
							value={p.name}
							disabled={purpose === "chat" && !fits(p.harness)}
						>
							{p.name} · {info(p.harness).label} · {p.model}
							{cannotChat(p.harness)}
						</NativeSelectOption>
					))}
					{unknownProfile ? (
						<NativeSelectOption value={choice.profile}>
							{choice.profile} (not found)
						</NativeSelectOption>
					) : null}
				</NativeSelect>
				{locked ? (
					<FieldDescription className="text-xs">
						Add a profile on the Agents page, or choose None to pick a harness
						and model here.
					</FieldDescription>
				) : none ? null : (
					<FieldDescription className="text-xs">
						Change a field below to override the profile here. Choose From the
						profile to undo.
					</FieldDescription>
				)}
			</Field>

			<Field>
				<FieldLabel htmlFor={`${id}-harness`}>Harness</FieldLabel>
				<NativeSelect
					id={`${id}-harness`}
					size="sm"
					className="w-full"
					disabled={locked}
					value={choice.harness ?? ""}
					aria-invalid={
						(refusal !== null && choice.harness !== undefined) || undefined
					}
					onChange={(event) => {
						const next = event.target.value as HarnessName | "";
						if (next === "") change({ harness: undefined });
						// A model of the old harness means nothing to the new one.
						else
							change({
								harness: next,
								model: none ? info(next).defaultModel : undefined,
							});
					}}
				>
					{!none ? (
						<NativeSelectOption value="">
							{fromProfile(profile ? info(profile.harness).label : "unknown")}
						</NativeSelectOption>
					) : null}
					{harnessOptions.map(({ value, label }) => (
						<NativeSelectOption
							key={value}
							value={value}
							disabled={purpose === "chat" && !fits(value)}
						>
							{label}
							{cannotChat(value)}
						</NativeSelectOption>
					))}
				</NativeSelect>
				{refusal ? (
					<FieldDescription className="text-destructive text-xs">
						{refusal}
					</FieldDescription>
				) : null}
			</Field>

			<div className="grid grid-cols-2 gap-3">
				<Field>
					<FieldLabel htmlFor={`${id}-model`}>Model</FieldLabel>
					<ModelCombobox
						id={`${id}-model`}
						harness={harnessName}
						value={choice.model ?? ""}
						placeholder={
							none ? harness.defaultModel : (profile?.model ?? undefined)
						}
						onChange={(model) =>
							change({ model: model === "" && !none ? undefined : model })
						}
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor={`${id}-effort`}>Effort</FieldLabel>
					<NativeSelect
						id={`${id}-effort`}
						size="sm"
						className="w-full"
						disabled={locked}
						value={choice.effort ?? ""}
						onChange={(event) =>
							change({
								effort: (event.target.value || undefined) as Effort | undefined,
							})
						}
					>
						<NativeSelectOption value="">
							{none
								? "Model default"
								: fromProfile(profile?.effort ?? "model default")}
						</NativeSelectOption>
						{EFFORTS.map((value) => (
							<NativeSelectOption key={value} value={value}>
								{value}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
			</div>
		</FieldGroup>
	);
}
