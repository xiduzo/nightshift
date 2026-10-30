/**
 * Which agent answers, as two menus in the row under a Prompt Input (the
 * AI Elements Model Selector): one for the agent (a profile, or a model
 * of a harness), one for the effort. The field helpers and the chat share
 * the choice, and this browser keeps it (`agent-choice.ts`).
 */
import { type AssistantAgent, harnessTakesTools } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Field, FieldLabel } from "@nightshift/ui/components/field";
import { InputGroupButton } from "@nightshift/ui/components/input-group";
import { useQuery } from "@tanstack/react-query";
import { BotIcon, ChevronDownIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState } from "react";
import {
	EFFORTS,
	type HarnessName,
	harnessInfo,
	harnessQueries,
	ModelCombobox,
	profileQueries,
	useCustomAgents,
	useHarnessModels,
} from "@/features/agents";
import { settingsQueries } from "@/features/settings/queries";
import type { AgentProfileRow, Effort } from "@/shared/api";
import {
	type AgentChoice,
	currentAgentChoice,
	pickModel,
	profileModel,
	requestAgent,
	setAgentChoice,
	useAgentChoice,
} from "./agent-choice";

/** What the agent is for: the chat needs a harness that can use its tools. */
export type AgentPurpose = "suggest" | "chat";

/** The profile radio's value for the profile for help, and for no profile. Profile names cannot hold a colon. */
const HELP = ":help";
const NONE = ":none";
/** The effort radio's value for "no effort set here". */
const NO_EFFORT = ":default";

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

type Options = ReturnType<typeof useAgentOptions>;

/** The request fields of the choice now, for a request sent from a callback. */
export function agentRequest(): AssistantAgent {
	return requestAgent(
		currentAgentChoice(),
		(harness) => harnessInfo(harness).defaultModel,
	);
}

/** What the menus show for a choice: the profile in use, the harness, model and effort that answer. */
function resolve(choice: AgentChoice, options: Options) {
	const none = choice.profile === undefined && choice.harness !== undefined;
	const usesHelp = choice.profile === undefined && !none;
	const profile: AgentProfileRow | undefined = usesHelp
		? options.forHelp
		: options.profiles.find((p) => p.name === choice.profile);
	const harness: HarnessName =
		choice.harness ??
		profile?.harness ??
		options.harnesses[0]?.name ??
		"claude-code";
	const model =
		choice.model ??
		(none ? options.info(harness).defaultModel : (profile?.model ?? ""));
	const effort = choice.effort ?? (none ? undefined : profile?.effort);
	return {
		none,
		usesHelp,
		profile,
		harness,
		model,
		effort,
		// The profile for help, and there is none: only a harness and model can answer.
		locked: usesHelp && !options.forHelp,
	};
}

/** The trigger's words: "Profile for help", "worker · haiku", "Claude Code · haiku". */
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
	return parts.filter(Boolean).join(" · ");
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
	const harness = choice.harness ?? profile?.harness;
	if (harness === undefined || options.fits(harness)) return null;
	return `${options.info(harness).label} cannot read your flow or propose changes. Choose Claude Code, Codex or OpenCode for the chat.`;
}

/** The agent's two menus, for the `block-end` row of a Prompt Input. */
export function AgentMenus({ purpose }: { purpose: AgentPurpose }) {
	const choice = useAgentChoice();
	const options = useAgentOptions(purpose);
	const now = resolve(choice, options);
	const label = choiceLabel(choice, options.info);
	const refusal = chatRefusal(choice, purpose, options);
	const [otherModel, setOtherModel] = useState<HarnessName | null>(null);
	const pick = (harness: HarnessName, model: string) =>
		setAgentChoice(
			pickModel(
				choice,
				{ harness, model },
				now.profile && {
					name: now.profile.name,
					harness: now.profile.harness,
				},
			),
		);
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<InputGroupButton
							className="min-w-0 shrink font-normal text-muted-foreground"
							aria-label={`Agent: ${label}. Choose the agent.`}
							title={refusal ?? "Choose the agent that answers"}
						>
							{refusal ? (
								<TriangleAlertIcon className="text-destructive" />
							) : (
								<BotIcon />
							)}
							<span className="truncate">{label}</span>
							<ChevronDownIcon />
						</InputGroupButton>
					}
				/>
				<DropdownMenuContent align="start" className="w-72">
					{refusal ? (
						<DropdownMenuGroup>
							<DropdownMenuLabel className="font-normal text-destructive">
								{refusal}
							</DropdownMenuLabel>
						</DropdownMenuGroup>
					) : null}
					<ProfileGroup
						choice={choice}
						purpose={purpose}
						options={options}
						now={now}
					/>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuLabel>Model</DropdownMenuLabel>
						{harnessList(choice, options).map(({ name, added }) => (
							<DropdownMenuSub key={name}>
								<DropdownMenuSubTrigger
									disabled={purpose === "chat" && !options.fits(name)}
								>
									<span className="truncate">
										{options.info(name).label}
										{added ? "" : " (not added)"}
										{purpose === "chat" && !options.fits(name)
											? " (cannot chat)"
											: ""}
									</span>
									{name === now.harness ? (
										<DropdownMenuShortcut className="tracking-normal">
											{now.model}
										</DropdownMenuShortcut>
									) : null}
								</DropdownMenuSubTrigger>
								<DropdownMenuSubContent className="max-h-80 min-w-44">
									<HarnessModels
										harness={name}
										current={name === now.harness ? now.model : null}
										onPick={(model) => pick(name, model)}
										onOther={() => setOtherModel(name)}
									/>
								</DropdownMenuSubContent>
							</DropdownMenuSub>
						))}
						{!now.none && (choice.harness || choice.model) ? (
							<DropdownMenuItem
								onClick={() => setAgentChoice(profileModel(choice))}
							>
								Use the profile's model
								{now.profile?.model ? (
									<DropdownMenuShortcut className="tracking-normal">
										{now.profile.model}
									</DropdownMenuShortcut>
								) : null}
							</DropdownMenuItem>
						) : null}
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			<EffortMenu choice={choice} now={now} />
			{otherModel ? (
				<OtherModelDialog
					harness={otherModel}
					label={options.info(otherModel).label}
					initial={otherModel === now.harness ? now.model : ""}
					onClose={() => setOtherModel(null)}
					onPick={(model) => {
						pick(otherModel, model);
						setOtherModel(null);
					}}
				/>
			) : null}
		</>
	);
}

/** The harnesses the menu offers: the added ones, and the chosen one when it is not added. */
function harnessList(choice: AgentChoice, options: Options) {
	const list = options.harnesses.map((h) => ({ name: h.name, added: true }));
	if (choice.harness && !list.some((h) => h.name === choice.harness))
		list.push({ name: choice.harness, added: false });
	return list;
}

function ProfileGroup({
	choice,
	purpose,
	options,
	now,
}: {
	choice: AgentChoice;
	purpose: AgentPurpose;
	options: Options;
	now: ReturnType<typeof resolve>;
}) {
	const { profiles, forHelp, fits, info } = options;
	const value = now.usesHelp ? HELP : now.none ? NONE : (choice.profile ?? "");
	const unknown =
		choice.profile !== undefined &&
		!profiles.some((p) => p.name === choice.profile);
	return (
		<DropdownMenuGroup>
			<DropdownMenuLabel>Profile</DropdownMenuLabel>
			<DropdownMenuRadioGroup
				value={value}
				onValueChange={(next: string) => {
					if (next === HELP) setAgentChoice({});
					else if (next === NONE)
						// Keep what the profile gave, so the same agent answers.
						setAgentChoice({
							harness: now.harness,
							model: now.model || info(now.harness).defaultModel,
							...(now.effort ? { effort: now.effort } : {}),
						});
					else setAgentChoice({ profile: next });
				}}
			>
				<DropdownMenuRadioItem value={HELP} closeOnClick>
					<span className="truncate">Profile for help</span>
					<DropdownMenuShortcut className="tracking-normal">
						{forHelp ? forHelp.name : "none yet"}
					</DropdownMenuShortcut>
				</DropdownMenuRadioItem>
				{profiles.map((p) => (
					<DropdownMenuRadioItem
						key={p.name}
						value={p.name}
						closeOnClick
						disabled={purpose === "chat" && !fits(p.harness)}
					>
						<span className="truncate">{p.name}</span>
						<DropdownMenuShortcut className="truncate tracking-normal">
							{info(p.harness).label} · {p.model}
							{purpose === "chat" && !fits(p.harness) ? " (cannot chat)" : ""}
						</DropdownMenuShortcut>
					</DropdownMenuRadioItem>
				))}
				{unknown ? (
					<DropdownMenuRadioItem value={choice.profile ?? ""} closeOnClick>
						{choice.profile} (not found)
					</DropdownMenuRadioItem>
				) : null}
				<DropdownMenuRadioItem value={NONE} closeOnClick>
					No profile: choose a model below
				</DropdownMenuRadioItem>
			</DropdownMenuRadioGroup>
			{now.locked ? (
				<DropdownMenuLabel className="font-normal">
					Add a profile on the Agents page, or choose a model below.
				</DropdownMenuLabel>
			) : null}
		</DropdownMenuGroup>
	);
}

/** The models of one harness, the one in use checked, and a way to name another. */
function HarnessModels({
	harness,
	current,
	onPick,
	onOther,
}: {
	harness: HarnessName;
	/** The model in use, when this harness answers. */
	current: string | null;
	onPick: (model: string) => void;
	onOther: () => void;
}) {
	const { models } = useHarnessModels(harness);
	const list =
		current && !models.includes(current) ? [current, ...models] : models;
	return (
		<>
			<DropdownMenuRadioGroup value={current ?? ""} onValueChange={onPick}>
				{list.map((model) => (
					<DropdownMenuRadioItem key={model} value={model} closeOnClick>
						{model}
					</DropdownMenuRadioItem>
				))}
			</DropdownMenuRadioGroup>
			<DropdownMenuSeparator />
			<DropdownMenuItem onClick={onOther}>Other model…</DropdownMenuItem>
		</>
	);
}

function EffortMenu({
	choice,
	now,
}: {
	choice: AgentChoice;
	now: ReturnType<typeof resolve>;
}) {
	const fromProfile = !now.none && now.profile?.effort;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<InputGroupButton
						className="shrink-0 font-normal text-muted-foreground"
						disabled={now.locked}
						aria-label={`Effort: ${now.effort ?? "model default"}. Choose the effort.`}
						title="Choose how hard the agent thinks"
					>
						{now.effort ?? "Effort"}
						<ChevronDownIcon />
					</InputGroupButton>
				}
			/>
			<DropdownMenuContent align="start" className="w-48">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Effort</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={choice.effort ?? NO_EFFORT}
						onValueChange={(next: string) => {
							const effort = next === NO_EFFORT ? undefined : (next as Effort);
							// A change on the profile for help pins that profile.
							const base: AgentChoice = now.usesHelp
								? now.profile
									? { profile: now.profile.name }
									: {}
								: { ...choice };
							const { effort: _, ...rest } = base;
							setAgentChoice(effort ? { ...rest, effort } : rest);
						}}
					>
						<DropdownMenuRadioItem value={NO_EFFORT} closeOnClick>
							{fromProfile ? "From the profile" : "Model default"}
							{fromProfile ? (
								<DropdownMenuShortcut className="tracking-normal">
									{fromProfile}
								</DropdownMenuShortcut>
							) : null}
						</DropdownMenuRadioItem>
						{EFFORTS.map((value) => (
							<DropdownMenuRadioItem key={value} value={value} closeOnClick>
								{value}
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** A model the list does not hold: the harness takes any model its CLI knows. */
function OtherModelDialog({
	harness,
	label,
	initial,
	onClose,
	onPick,
}: {
	harness: HarnessName;
	label: string;
	initial: string;
	onClose: () => void;
	onPick: (model: string) => void;
}) {
	const id = useId();
	const [model, setModel] = useState(initial);
	return (
		<Dialog open onOpenChange={(open) => (open ? null : onClose())}>
			<DialogContent className="sm:max-w-sm">
				<form
					className="flex flex-col gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (model.trim()) onPick(model.trim());
					}}
				>
					<DialogHeader>
						<DialogTitle>Use another model</DialogTitle>
						<DialogDescription>
							Type the name of a model {label} supports. It does not need to be
							in the list.
						</DialogDescription>
					</DialogHeader>
					<Field>
						<FieldLabel htmlFor={id}>Model</FieldLabel>
						<ModelCombobox
							id={id}
							harness={harness}
							value={model}
							onChange={setModel}
						/>
					</Field>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={model.trim() === ""}>
							Use this model
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
