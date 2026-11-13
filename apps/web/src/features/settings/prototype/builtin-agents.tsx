/**
 * PROTOTYPE, throw away. Night Shift's agents: a table with a choice for
 * each of the six, and the page of one. An agent is chosen with the agent
 * picker the chat already has, a model with a select of your models.
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
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@nightshift/ui/components/table";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { profileQueries, useDeciderSetupStatus } from "@/features/agents";
import { BUILTINS, type Builtin, type BuiltinId, TAKES_LABEL } from "./model";

/** The agent picker of the chat, handed in by the route. */
export type AgentPicker = (props: {
	purpose: "chat" | "suggest";
	choice: AssistantAgent;
	onChoiceChange: (choice: AssistantAgent) => void;
}) => ReactNode;

type Choice = {
	/** For an agent that takes both: which kind answers. */
	kind: "agent" | "model";
	agent: AssistantAgent;
	/** A Model Profile's name. Empty: the decider of this computer. */
	model: string;
};

export type Choices = {
	of: (builtin: Builtin) => Choice;
	set: (id: BuiltinId, change: Partial<Choice>) => void;
};

export function useChoices(): Choices {
	const [choices, setChoices] = useState<Partial<Record<BuiltinId, Choice>>>(
		{},
	);
	const of = (builtin: Builtin): Choice =>
		choices[builtin.id] ?? {
			kind: builtin.takes === "model" ? "model" : "agent",
			agent: {},
			model: "",
		};
	return {
		of,
		set: (id, change) =>
			setChoices((now) => {
				const builtin = BUILTINS.find((item) => item.id === id);
				return builtin
					? { ...now, [id]: { ...of(builtin), ...now[id], ...change } }
					: now;
			}),
	};
}

/** Whether something can answer for a built-in agent on this computer. */
function useReady(choices: Choices) {
	const agents = useQuery(profileQueries.agents());
	const decider = useDeciderSetupStatus();
	const anyAgent = (agents.data ?? []).length > 0;
	const toolAgent = (agents.data ?? []).some((profile) =>
		harnessTakesTools(profile.harness),
	);
	return (builtin: Builtin): string | null => {
		const choice = choices.of(builtin);
		if (choice.kind === "model") {
			return decider.data?.current.chosen || choice.model !== ""
				? null
				: "Choose a model";
		}
		if (builtin.takes === "harness-with-tools") {
			return toolAgent ? null : "Needs an agent";
		}
		return anyAgent ? null : "Needs an agent";
	};
}

/** Who answers for one built-in agent: existing controls only. */
function AnswersWith({
	builtin,
	choices,
	agentPicker,
}: {
	builtin: Builtin;
	choices: Choices;
	agentPicker: AgentPicker;
}) {
	const models = useQuery(profileQueries.models());
	const decider = useDeciderSetupStatus();
	const choice = choices.of(builtin);
	return (
		<div className="flex flex-wrap items-center gap-2">
			{builtin.takes === "either" ? (
				<ToggleGroup
					variant="outline"
					size="sm"
					value={[choice.kind]}
					onValueChange={(value) => {
						const kind = value[0];
						if (kind === "agent" || kind === "model")
							choices.set(builtin.id, { kind });
					}}
					aria-label={`${builtin.name} answers with an agent or a model`}
				>
					<ToggleGroupItem value="agent">Agent</ToggleGroupItem>
					<ToggleGroupItem value="model">Model</ToggleGroupItem>
				</ToggleGroup>
			) : null}
			{choice.kind === "agent" ? (
				<InputGroup className="w-auto max-w-80">
					<InputGroupAddon>
						{agentPicker({
							purpose:
								builtin.takes === "harness-with-tools" ? "chat" : "suggest",
							choice: choice.agent,
							onChoiceChange: (agent) => choices.set(builtin.id, { agent }),
						})}
					</InputGroupAddon>
				</InputGroup>
			) : (
				<NativeSelect
					aria-label={`${builtin.name} answers with`}
					value={choice.model}
					onChange={(event) =>
						choices.set(builtin.id, { model: event.target.value })
					}
				>
					<NativeSelectOption value="">
						{decider.data
							? `The decider of this computer (${decider.data.current.decider})`
							: "The decider of this computer"}
					</NativeSelectOption>
					{(models.data ?? []).map((profile) => (
						<NativeSelectOption key={profile.id} value={profile.name}>
							{profile.name} · {profile.model ?? profile.decider}
						</NativeSelectOption>
					))}
				</NativeSelect>
			)}
		</div>
	);
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

export function BuiltinTable({
	choices,
	agentPicker,
	searchOf,
}: {
	choices: Choices;
	agentPicker: AgentPicker;
	searchOf: (agent: string) => { section?: string; agent?: string };
}) {
	const problemOf = useReady(choices);
	return (
		<div className="overflow-x-auto rounded-xl border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Agent</TableHead>
						<TableHead>Answers with</TableHead>
						<TableHead />
					</TableRow>
				</TableHeader>
				<TableBody>
					{BUILTINS.map((builtin) => (
						<TableRow key={builtin.id}>
							<TableCell>
								<Link
									to="/settings"
									search={searchOf(builtin.id)}
									className="font-medium underline-offset-4 hover:underline"
								>
									{builtin.name}
								</Link>
								<div className="text-muted-foreground text-xs">
									{builtin.job}
								</div>
							</TableCell>
							<TableCell>
								<AnswersWith
									builtin={builtin}
									choices={choices}
									agentPicker={agentPicker}
								/>
							</TableCell>
							<TableCell className="text-right">
								<State problem={problemOf(builtin)} />
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
	const problemOf = useReady(choices);
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
							builtin={builtin}
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
