/**
 * PROTOTYPE, throw away. Who answers: a table with one row for each of
 * Night Shift's agents, for a new node, and for meaning search. Every
 * row uses the agent picker of the chat. Its list holds your agents and
 * your models together, and a row shows only what can answer for it.
 * Choices stay in this tab.
 */
import { type AssistantAgent, harnessTakesTools } from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
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
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Field, FieldLabel } from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
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
import {
	ChevronDownIcon,
	CircleAlertIcon,
	CircleCheckIcon,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import {
	deciderQueries,
	profileQueries,
	useDeciderSetupStatus,
} from "@/features/agents";
import { SHORTLIST } from "../components/meaning-search-card";
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
type Where = "here" | "there" | "off";
type Choice = {
	agent: AssistantAgent;
	model: string | undefined;
	/** Meaning search: where its model runs. */
	where?: Where;
	address?: string;
};

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
			const address = values?.ollamaAddress.trim() ?? "";
			return {
				agent: {},
				model: values?.embeddingModel,
				where: values?.ollama === "off" ? "off" : address ? "there" : "here",
				address,
			};
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

/** Whether Ollama has a model, by its name with or without `:latest`. */
function useDownloaded() {
	const models = useQuery({
		...ollamaQueries.models(),
		meta: { quietErrors: true },
	});
	const have = (models.data ?? []).map((model) => model.name);
	return {
		have,
		has: (name: string | undefined) =>
			name !== undefined &&
			(have.includes(name) || have.includes(`${name}:latest`)),
	};
}

/** The models that search by meaning: the ones that work well, and the ones Ollama has. */
function useSearchOptions(current: string | undefined): ModelOption[] {
	const { have, has } = useDownloaded();
	const names = new Set([
		...SHORTLIST.map((model) => model.name),
		...have.map((name) => name.replace(/:latest$/, "")),
		...(current ? [current] : []),
	]);
	return [...names].map((name) => ({
		value: name,
		label: name,
		hint: has(name) ? "Downloaded" : "Downloads when you pick it",
	}));
}

/** Where the model of meaning search runs: a second menu, like the effort of an agent. */
function WhereMenu({
	choice,
	onChange,
}: {
	choice: Choice;
	onChange: (change: Partial<Choice>) => void;
}) {
	const id = useId();
	const [asking, setAsking] = useState(false);
	const [address, setAddress] = useState(choice.address ?? "");
	const where = choice.where ?? "here";
	const label =
		where === "off"
			? "Off"
			: where === "there"
				? choice.address || "Another computer"
				: "This computer";
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<InputGroupButton
							className="min-w-0 shrink font-normal text-muted-foreground"
							aria-label={`Runs on: ${label}. Choose where search by meaning runs.`}
						>
							<span className="truncate">{label}</span>
							<ChevronDownIcon />
						</InputGroupButton>
					}
				/>
				<DropdownMenuContent align="start" className="w-72">
					<DropdownMenuGroup>
						<DropdownMenuLabel>Runs on</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							value={where}
							onValueChange={(next: string) => {
								if (next === "there" && !choice.address) setAsking(true);
								else onChange({ where: next as Where });
							}}
						>
							<DropdownMenuRadioItem value="here" closeOnClick>
								This computer
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="there" closeOnClick>
								<span className="truncate">Another computer</span>
								{choice.address ? (
									<DropdownMenuShortcut className="truncate tracking-normal">
										{choice.address}
									</DropdownMenuShortcut>
								) : null}
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="off" closeOnClick>
								Off: find by words only
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuItem onClick={() => setAsking(true)}>
						{choice.address ? "Change the address…" : "Add an address…"}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={asking} onOpenChange={setAsking}>
				<DialogContent className="sm:max-w-sm">
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (!address.trim()) return;
							onChange({ where: "there", address: address.trim() });
							setAsking(false);
						}}
					>
						<DialogHeader>
							<DialogTitle>Run search on another computer</DialogTitle>
							<DialogDescription>
								Night Shift sends your knowledge text to that computer, where
								the model reads it.
							</DialogDescription>
						</DialogHeader>
						<Field>
							<FieldLabel htmlFor={id}>Ollama address</FieldLabel>
							<Input
								id={id}
								className="font-mono"
								placeholder="http://192.168.1.20:11434"
								value={address}
								onChange={(event) => setAddress(event.target.value)}
							/>
						</Field>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setAsking(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={address.trim() === ""}>
								Use this address
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
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
				{row.id === "search" ? (
					<WhereMenu
						choice={choice}
						onChange={(change) => choices.set(row, change)}
					/>
				) : null}
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
	const { has } = useDownloaded();
	return (row: Row): string | null => {
		const choice = choices.of(row);
		const takes = row.takes as string;
		if (row.id === "search") {
			if (choice.where === "off") return "Off";
			if (choice.model === undefined) return "Choose a model";
			if (choice.where === "there") return null;
			return has(choice.model) ? null : "Downloads when you save";
		}
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
