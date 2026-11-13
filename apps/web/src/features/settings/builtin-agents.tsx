/**
 * Night Shift's agents: a table with who answers for each, and the page of
 * one agent. A pick saves at once in the settings of this computer. An
 * agent with nothing saved shows what this computer uses now.
 */
import {
	BUILTIN_AGENTS,
	type BuiltinAgent,
	type BuiltinAgentId,
	type BuiltinAnswer,
	type BuiltinStatus,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { RotateCcwIcon } from "lucide-react";
import { harnessInfo, TryAgentButton } from "@/features/agents";
import type { SettingsView } from "@/shared/api";
import { PageSection, SettingRow, SettingRows } from "@/shared/page";
import {
	type AgentPicker,
	AnswersTable,
	PickerFrame,
	State,
	useModelOptions,
	useSaveNow,
} from "./answers-table";
import {
	answerOfAgent,
	answerOfModel,
	limitText,
	shownAnswer,
	TAKES_LABEL,
} from "./builtin-answer";
import { builtinQueries, settingsQueries } from "./queries";

/**
 * The saved answers of Night Shift's agents, who answers for each now, and
 * the save of one answer. The record is saved whole: an agent without an
 * entry follows this computer.
 */
function useBuiltinAnswers() {
	const queryClient = useQueryClient();
	const settings = useQuery(settingsQueries.get());
	const status = useQuery(builtinQueries.status());
	const saveNow = useSaveNow();
	return {
		ready: settings.data !== undefined && !status.isPending,
		/** Who answers now did not load. */
		failed: status.isError && status.data === undefined,
		saved: (id: BuiltinAgentId) => settings.data?.values.builtinAgents[id],
		status: (id: BuiltinAgentId) => status.data?.find((item) => item.id === id),
		/** Saves who answers for `id`. Null: back to this computer's choice. */
		set: (id: BuiltinAgentId, answer: BuiltinAnswer | null) => {
			// The newest record: a pick right after another keeps the first.
			const now =
				queryClient.getQueryData<SettingsView>(settingsQueries.get().queryKey)
					?.values.builtinAgents ?? {};
			const { [id]: _, ...rest } = now;
			const next = answer ? { ...rest, [id]: answer } : rest;
			saveNow({
				builtinAgents: Object.keys(next).length > 0 ? next : null,
			});
		},
	};
}

type BuiltinAnswers = ReturnType<typeof useBuiltinAnswers>;

/** Who answers for one of Night Shift's agents, and the way back to this computer's choice. */
function BuiltinAnswerPicker({
	agent,
	answers,
	agentPicker,
}: {
	agent: BuiltinAgent;
	answers: BuiltinAnswers;
	agentPicker: AgentPicker;
}) {
	const modelOptions = useModelOptions();
	if (!answers.ready) return <Skeleton className="h-9 w-56" />;
	const saved = answers.saved(agent.id);
	const shown = shownAnswer(saved, answers.status(agent.id));
	return (
		<>
			<PickerFrame>
				{agentPicker({
					// An agent that works in turns needs a harness that takes Night Shift's tools, as the chat does.
					purpose: agent.takes === "agent-with-tools" ? "chat" : "suggest",
					choice: shown.agent,
					onChoiceChange: (choice) => {
						const model = choice.model?.trim();
						answers.set(
							agent.id,
							answerOfAgent({
								...choice,
								model:
									model ||
									(choice.profile === undefined && choice.harness
										? harnessInfo(choice.harness).defaultModel
										: undefined),
							}),
						);
					},
					agents: agent.takes !== "model",
					models:
						agent.takes === "agent-with-tools"
							? undefined
							: {
									label: "Models",
									options: modelOptions,
									value: shown.model,
									// The picker clears the model before it gives an agent: the agent saves then.
									onPick: (value) => {
										const answer = value ? answerOfModel(value) : null;
										if (answer) answers.set(agent.id, answer);
									},
								},
				})}
			</PickerFrame>
			{saved ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`Use this computer's choice for the ${agent.name}`}
								onClick={() => answers.set(agent.id, null)}
							/>
						}
					>
						<RotateCcwIcon />
					</TooltipTrigger>
					<TooltipContent>Use this computer's choice</TooltipContent>
				</Tooltip>
			) : null}
		</>
	);
}

/** Whether something answers for the agent now. */
function BuiltinState({
	status,
	failed,
}: {
	status: BuiltinStatus | undefined;
	/** The state did not load. */
	failed: boolean;
}) {
	if (failed) {
		return (
			<State
				problem="Did not load"
				detail="Night Shift could not check this agent. Load the page again."
			/>
		);
	}
	if (!status) return <Skeleton className="ml-auto h-5 w-16" />;
	return (
		<State
			problem={status.problem === null ? null : "Cannot answer"}
			detail={status.problem}
		/>
	);
}

/** Night Shift's agents: who answers for each, and whether it can. A name opens the page of its agent. */
export function BuiltinAgentsTable({
	agentPicker,
}: {
	agentPicker: AgentPicker;
}) {
	const answers = useBuiltinAnswers();
	return (
		<AnswersTable
			first="Agent"
			rows={BUILTIN_AGENTS.map((agent) => ({
				key: agent.id,
				name: (
					<Link
						to="/settings"
						search={{ section: "builtin", agent: agent.id }}
						className="underline-offset-4 hover:underline"
					>
						{agent.name}
					</Link>
				),
				job: agent.job,
				answersWith: (
					<BuiltinAnswerPicker
						agent={agent}
						answers={answers}
						agentPicker={agentPicker}
					/>
				),
				state: (
					<BuiltinState
						status={answers.status(agent.id)}
						failed={answers.failed}
					/>
				),
			}))}
		/>
	);
}

/** The page of one of Night Shift's agents: who answers, the most it spends, and what it does. */
export function BuiltinAgentDetail({
	agent,
	agentPicker,
}: {
	agent: BuiltinAgent;
	agentPicker: AgentPicker;
}) {
	const answers = useBuiltinAnswers();
	const status = answers.status(agent.id);
	const agentLimit =
		agent.limits.usd !== undefined || agent.limits.turns !== undefined;
	const facts: [string, string][] = [
		["You start it with", agent.startedBy],
		["Reads", agent.reads],
		["Proposes", agent.proposes],
		["Never", agent.never],
	];
	return (
		<>
			<TryAgentButton agent={agent.id} />
			<SettingRows>
				<SettingRow
					label="Answers with"
					description={
						answers.ready && !answers.saved(agent.id)
							? `${TAKES_LABEL[agent.takes]}. This computer picks until you choose.`
							: `${TAKES_LABEL[agent.takes]}.`
					}
					error={status?.problem}
				>
					<BuiltinAnswerPicker
						agent={agent}
						answers={answers}
						agentPicker={agentPicker}
					/>
					<BuiltinState status={status} failed={answers.failed} />
				</SettingRow>
				<SettingRow
					label="Most it spends on one answer"
					description={
						!agentLimit
							? undefined
							: agent.takes === "either"
								? "An agent stops at the first of these. A model makes one call."
								: "The agent stops at the first of these."
					}
				>
					<span className="text-muted-foreground tabular-nums">
						{limitText(agent.limits)}
					</span>
				</SettingRow>
			</SettingRows>
			<PageSection title="What it does">
				<SettingRows first="About" second="">
					{facts.map(([term, text]) => (
						<SettingRow key={term} label={term}>
							{text}
						</SettingRow>
					))}
				</SettingRows>
			</PageSection>
		</>
	);
}
