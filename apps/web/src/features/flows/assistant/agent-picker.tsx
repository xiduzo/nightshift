/**
 * Which agent answers, as two menus in the row under a Prompt Input (the
 * AI Elements Model Selector): one for the agent (a profile, or a model
 * of a harness), one for the effort. Its owner keeps the choice: a quick
 * run, the Settings page of one of Night Shift's own agents, or a place
 * that asks one of them (`useBuiltinPick`). There the menu starts on the
 * agent's default from Settings, and a pick holds for that place only.
 */
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
import { InputGroupButton } from "@nightshift/ui/components/input-group";
import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	ChevronDownIcon,
	CpuIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useState } from "react";
import type { HarnessName } from "@/features/agents";
import { builtinSettingsSearch } from "@/shared/agent-button";
import { type AgentChoice, pickModel, profileModel } from "./agent-choice";
import type { AgentPurpose, DefaultAnswer } from "./agent-options";
import {
	chatRefusal,
	choiceLabel,
	harnessList,
	resolve,
	useAgentOptions,
} from "./agent-options";
import { EffortMenu } from "./effort-menu";
import { HarnessModels, OtherModelDialog } from "./harness-models";
import { ProfileGroup } from "./profile-group";

/** Who keeps the choice. */
type ChoiceStore = {
	/**
	 * The default from Settings, first in the agent menu. Unset: the
	 * profile for help is the first item, or none for a run.
	 */
	fallback?: DefaultAnswer;
	choice: AgentChoice;
	onChoiceChange: (choice: AgentChoice) => void;
};

/** Models that give one answer, in the same list as the agents: Settings offers both for one choice. */
export type ModelOptions = {
	/** The group's label. */
	label?: string;
	options: readonly {
		value: string;
		label: string;
		/** Short, on the right: its state or its model. */
		hint?: string;
		/** One line under the name: what it is. */
		about?: string;
		/** The heading it sits under. */
		group?: string;
	}[];
	/** The model that answers. Undefined: an agent answers. */
	value: string | undefined;
	onPick: (value: string | undefined) => void;
	/** Opens a way to name a model the list does not hold. Without it, the list is all. */
	onOther?: () => void;
};

export type AgentMenusProps = {
	purpose: AgentPurpose;
	models?: ModelOptions;
	/** False: only models can answer. */
	agents?: boolean;
	/** False: no effort menu, for a choice that keeps no effort. */
	effort?: boolean;
} & ChoiceStore;

/** The agent's two menus, for the `block-end` row of a Prompt Input. */
export function AgentMenus({
	purpose,
	choice,
	onChoiceChange,
	models,
	agents = true,
	effort = true,
	fallback,
}: AgentMenusProps) {
	const modelOn = models?.value !== undefined || !agents;
	const pickedModel = models?.options.find((o) => o.value === models.value);
	const set = (next: AgentChoice) => {
		models?.onPick(undefined);
		onChoiceChange(next);
	};
	const options = useAgentOptions(purpose);
	const now = resolve(choice, options);
	const label = modelOn
		? (pickedModel?.label ?? models?.value ?? "Choose a model")
		: choiceLabel(choice, options.info);
	const refusal = modelOn ? null : chatRefusal(choice, purpose, options);
	const [otherModel, setOtherModel] = useState<HarnessName | null>(null);
	const pick = (harness: HarnessName, model: string) =>
		set(
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
							) : modelOn ? (
								<CpuIcon />
							) : (
								<BotIcon />
							)}
							<span className="truncate">{label}</span>
							<ChevronDownIcon />
						</InputGroupButton>
					}
				/>
				<DropdownMenuContent
					align="start"
					className={models ? "w-[30rem] max-w-[90vw]" : "w-72"}
				>
					{refusal ? (
						<DropdownMenuGroup>
							<DropdownMenuLabel className="font-normal text-destructive">
								{refusal}
							</DropdownMenuLabel>
						</DropdownMenuGroup>
					) : null}
					{agents ? (
						<>
							<ProfileGroup
								choice={choice}
								set={set}
								purpose={purpose}
								options={options}
								now={now}
								off={modelOn}
								fallback={fallback}
							/>
							<DropdownMenuSeparator />
							<DropdownMenuGroup>
								<DropdownMenuLabel>
									{models ? "A harness and its model" : "Model"}
								</DropdownMenuLabel>
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
									<DropdownMenuItem onClick={() => set(profileModel(choice))}>
										Use the profile's model
										{now.profile?.model ? (
											<DropdownMenuShortcut className="tracking-normal">
												{now.profile.model}
											</DropdownMenuShortcut>
										) : null}
									</DropdownMenuItem>
								) : null}
							</DropdownMenuGroup>
						</>
					) : null}
					{models ? (
						<>
							{agents ? <DropdownMenuSeparator /> : null}
							{[...new Set(models.options.map((option) => option.group))].map(
								(group) => (
									<DropdownMenuGroup key={group ?? ""}>
										<DropdownMenuLabel>
											{group ?? models.label ?? "Models"}
										</DropdownMenuLabel>
										<DropdownMenuRadioGroup
											value={fallback?.active ? "" : (models.value ?? "")}
											onValueChange={(next: string) => models.onPick(next)}
										>
											{models.options
												.filter((option) => option.group === group)
												.map((option) => (
													<DropdownMenuRadioItem
														key={option.value}
														value={option.value}
														closeOnClick
														className="items-start"
													>
														<span className="flex min-w-0 flex-1 flex-col">
															<span>{option.label}</span>
															{option.about ? (
																<span className="text-xs text-muted-foreground">
																	{option.about}
																</span>
															) : null}
														</span>
														{option.hint ? (
															<DropdownMenuShortcut className="shrink-0 tracking-normal">
																{option.hint}
															</DropdownMenuShortcut>
														) : null}
													</DropdownMenuRadioItem>
												))}
										</DropdownMenuRadioGroup>
									</DropdownMenuGroup>
								),
							)}
							{models.onOther ? (
								<>
									<DropdownMenuSeparator />
									<DropdownMenuItem onClick={models.onOther}>
										Other model…
									</DropdownMenuItem>
								</>
							) : null}
						</>
					) : null}
					{fallback ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								render={
									<Link
										to="/settings"
										search={builtinSettingsSearch(fallback.agent)}
									/>
								}
							>
								Change the default…
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			{modelOn || !effort ? null : (
				<EffortMenu choice={choice} set={set} now={now} />
			)}
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
