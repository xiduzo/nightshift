/**
 * PROTOTYPE, throw away. Who answers: a table with one row for each of
 * Night Shift's agents, for a new node, and for meaning search. Every
 * row uses the agent picker of the chat. Its list holds your agents and
 * your models together, and a row shows only what can answer for it.
 * Choices stay in this tab.
 */
import { type AssistantAgent, harnessTakesTools } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	InputGroup,
	InputGroupAddon,
} from "@nightshift/ui/components/input-group";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
	deciderQueries,
	profileQueries,
	useDeciderSetupStatus,
} from "@/features/agents";
import { ollamaQueries, settingsQueries } from "../queries";
import { type Builtin, TAKES_LABEL, type Takes } from "./model";

type ModelOption = { value: string; label: string; hint?: string };

/** The agent picker of the chat, handed in by the route. */
export type AgentPicker = (props: {
	purpose: "chat" | "suggest" | "run";
	choice: AssistantAgent;
	onChoiceChange: (choice: AssistantAgent) => void;
	agents?: boolean;
	models?: {
		label?: string;
		options: readonly ModelOption[];
		value: string | undefined;
		onPick: (value: string | undefined) => void;
	};
}) => ReactNode;

/** A row of the table that is not one of the six agents. */
export type OtherRow = {
	id: "new-agent" | "new-decision" | "search";
	name: string;
	job: string;
	takes: Takes | "embedding" | "harness";
};

export const NEW_NODES: readonly OtherRow[] = [
	{
		id: "new-agent",
		name: "A new Agent node",
		job: "What an Agent node starts with.",
		takes: "harness",
	},
	{
		id: "new-decision",
		name: "A new Decision node",
		job: "The model a new Decision uses to choose.",
		takes: "model",
	},
];

export const SEARCH: OtherRow = {
	id: "search",
	name: "Meaning search",
	job: "Finds knowledge by what it means.",
	takes: "embedding",
};

type Row = Builtin | OtherRow;
type Choice = { agent: AssistantAgent; model: string | undefined };

export type Choices = {
	of: (row: Row) => Choice;
	set: (row: Row, change: Partial<Choice>) => void;
};

/** The choices of this tab. A row with nothing picked starts on what this computer uses now. */
export function useChoices(): Choices {
	const settings = useQuery(settingsQueries.get());
	const decider = useDeciderSetupStatus();
	const [choices, setChoices] = useState<Record<string, Choice>>({});
	const values = settings.data?.values;
	const start = (row: Row): Choice => {
		const takes = row.takes as string;
		if (row.id === "search") {
			return { agent: {}, model: values?.embeddingModel };
		}
		if (row.id === "new-agent") {
			return {
				agent: values
					? { harness: values.agentHarness, model: values.agentModel }
					: {},
				model: undefined,
			};
		}
		if (takes === "model") {
			return {
				agent: {},
				model: decider.data
					? `decider:${decider.data.current.decider}`
					: undefined,
			};
		}
		return { agent: {}, model: undefined };
	};
	const of = (row: Row) => choices[row.id] ?? start(row);
	return {
		of,
		set: (row, change) =>
			setChoices((now) => ({ ...now, [row.id]: { ...of(row), ...change } })),
	};
}

/** Your models: the model profiles, then the deciders of this computer. */
function useModelOptions(): ModelOption[] {
	const profiles = useQuery(profileQueries.models());
	const deciders = useQuery(deciderQueries.list());
	return [
		...(profiles.data ?? []).map((profile) => ({
			value: `profile:${profile.name}`,
			label: profile.name,
			hint: profile.model ?? profile.decider,
		})),
		...(deciders.data ?? []).map((decider) => ({
			value: `decider:${decider.name}`,
			label: decider.label,
			hint: decider.defaultModel ?? undefined,
		})),
	];
}

/** The models that search by meaning. */
function useSearchOptions(current: string | undefined): ModelOption[] {
	const models = useQuery({
		...ollamaQueries.models(),
		meta: { quietErrors: true },
	});
	const names = new Set([
		...(current ? [current] : []),
		...(models.data ?? []).map((model) => model.name),
	]);
	return [...names].map((name) => ({ value: name, label: name }));
}

/** Who answers for one row: the same picker everywhere. */
function AnswersWith({
	row,
	choices,
	agentPicker,
}: {
	row: Row;
	choices: Choices;
	agentPicker: AgentPicker;
}) {
	const choice = choices.of(row);
	const takes = row.takes as string;
	const modelOptions = useModelOptions();
	const searchOptions = useSearchOptions(
		row.id === "search" ? choice.model : undefined,
	);
	const withModels = takes === "either" || takes === "model";
	return (
		<InputGroup className="w-auto max-w-96">
			<InputGroupAddon>
				{agentPicker({
					purpose:
						row.id === "new-agent"
							? "run"
							: takes === "harness-with-tools"
								? "chat"
								: "suggest",
					choice: choice.agent,
					onChoiceChange: (agent) =>
						choices.set(row, { agent, model: undefined }),
					agents: takes !== "model" && takes !== "embedding",
					models:
						row.id === "search"
							? {
									label: "Models for search",
									options: searchOptions,
									value: choice.model,
									onPick: (model) => choices.set(row, { model }),
								}
							: withModels
								? {
										label: "Models",
										options:
											row.id === "new-decision"
												? modelOptions.filter((o) =>
														o.value.startsWith("decider:"),
													)
												: modelOptions,
										value: choice.model,
										onPick: (model) => choices.set(row, { model }),
									}
								: undefined,
				})}
			</InputGroupAddon>
		</InputGroup>
	);
}

/** Whether something can answer for a row on this computer. */
function useProblem(choices: Choices) {
	const agents = useQuery(profileQueries.agents());
	const anyAgent = (agents.data ?? []).length > 0;
	const toolAgent = (agents.data ?? []).some((profile) =>
		harnessTakesTools(profile.harness),
	);
	return (row: Row): string | null => {
		const choice = choices.of(row);
		const takes = row.takes as string;
		if (choice.model !== undefined) return null;
		if (takes === "model" || takes === "embedding") return "Choose a model";
		if (row.id === "new-agent") return null;
		if (takes === "harness-with-tools") {
			return toolAgent ? null : "Needs an agent";
		}
		return anyAgent ? null : "Needs an agent";
	};
}

function State({ problem }: { problem: string | null }) {
	return problem === null ? (
		<Badge variant="outline" className="gap-1.5">
			<CircleCheckIcon className="text-status-finished" />
			Ready
		</Badge>
	) : (
		<Badge variant="outline" className="gap-1.5 text-status-waiting">
			<CircleAlertIcon />
			{problem}
		</Badge>
	);
}

export function AnswersTable({
	rows,
	first,
	choices,
	agentPicker,
	searchOf,
}: {
	rows: readonly Row[];
	/** The head of the first column. */
	first: string;
	choices: Choices;
	agentPicker: AgentPicker;
	/** The search of the page of a built-in agent. None: the name is no link. */
	searchOf?: (agent: string) => { section?: string; agent?: string };
}) {
	const problemOf = useProblem(choices);
	return (
		<div className="overflow-x-auto rounded-xl border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-64">{first}</TableHead>
						<TableHead>Answers with</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.id}>
							<TableCell>
								{searchOf ? (
									<Link
										to="/settings"
										search={searchOf(row.id)}
										className="font-medium underline-offset-4 hover:underline"
									>
										{row.name}
									</Link>
								) : (
									<span className="font-medium">{row.name}</span>
								)}
								<div className="text-muted-foreground text-xs">{row.job}</div>
							</TableCell>
							<TableCell>
								<AnswersWith
									row={row}
									choices={choices}
									agentPicker={agentPicker}
								/>
							</TableCell>
							<TableCell className="text-right">
								<State problem={problemOf(row)} />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

/** One built-in agent: what it does in words, and its two settings. */
export function BuiltinDetail({
	builtin,
	choices,
	agentPicker,
}: {
	builtin: Builtin;
	choices: Choices;
	agentPicker: AgentPicker;
}) {
	const problemOf = useProblem(choices);
	const facts: [string, string][] = [
		["You start it with", builtin.startedBy],
		["Reads", builtin.reads],
		["Proposes", builtin.proposes],
		["Never", builtin.never],
	];
	return (
		<div className="flex flex-col gap-6">
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
				{facts.map(([term, text]) => (
					<div key={term} className="contents">
						<dt className="text-muted-foreground">{term}</dt>
						<dd>{text}</dd>
					</div>
				))}
			</dl>
			<ItemGroup className="gap-2">
				<Item variant="outline" size="sm">
					<ItemContent>
						<ItemTitle>
							Answers with <State problem={problemOf(builtin)} />
						</ItemTitle>
						<ItemDescription>{TAKES_LABEL[builtin.takes]}.</ItemDescription>
					</ItemContent>
					<ItemActions>
						<AnswersWith
							row={builtin}
							choices={choices}
							agentPicker={agentPicker}
						/>
					</ItemActions>
				</Item>
				<Item variant="outline" size="sm">
					<ItemContent>
						<ItemTitle>Most it spends on one answer</ItemTitle>
					</ItemContent>
					<ItemActions>
						<span className="text-muted-foreground text-sm tabular-nums">
							{builtin.limit}
						</span>
					</ItemActions>
				</Item>
			</ItemGroup>
		</div>
	);
}
