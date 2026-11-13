/**
 * What new work starts with: the agent of a new Agent node, the decider of
 * a new Decision node, and the model and the Ollama of meaning search.
 * Each is a row with the agent picker, and a pick saves at once.
 */
import { isCustomHarness } from "@nightshift/flows";
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
import { Field, FieldError, FieldLabel } from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { InputGroupButton } from "@nightshift/ui/components/input-group";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	deciderQueries,
	harnessInfo,
	harnessQueries,
	profileQueries,
} from "@/features/agents";
import type { SettingsView } from "@/shared/api";
import {
	type AgentPicker,
	AnswersTable,
	type ModelOption,
	PickerFrame,
	State,
	useModelOptions,
	useSaveNow,
} from "./answers-table";
import { deciderOfValue, deciderValue } from "./builtin-answer";
import {
	ollamaModes,
	SHORTLIST,
	useOllamaStatus,
} from "./components/meaning-search-card";
import { ollamaQueries } from "./queries";

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
		</PickerFrame>
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
					job: "What an Agent node starts with.",
					answersWith: <NewAgentPicker data={data} agentPicker={agentPicker} />,
					state: <NewAgentState data={data} />,
				},
				{
					key: "new-decision",
					name: "A new Decision node",
					job: "The model a new Decision uses to choose.",
					answersWith: (
						<NewDecisionPicker data={data} agentPicker={agentPicker} />
					),
					state: <NewDecisionState data={data} />,
				},
			]}
		/>
	);
}

/** The models that search by meaning: the ones that work well, and the ones Ollama has. */
function useSearchOptions(current: string): ModelOption[] {
	const models = useQuery({
		...ollamaQueries.models(),
		staleTime: 60_000,
		meta: { quietErrors: true },
	});
	const have = (models.data ?? []).map((model) => model.name);
	const has = (name: string) =>
		have.includes(name) || have.includes(`${name}:latest`);
	const names = new Set([
		...SHORTLIST.map((model) => model.name),
		...have.map((name) => name.replace(/:latest$/, "")),
		current,
	]);
	return [...names].map((name) => {
		const known = SHORTLIST.find((model) => model.name === name);
		return {
			value: name,
			label: name,
			hint: has(name) ? "Downloaded" : "Not downloaded",
			about: known?.about,
			group: known ? "Models that work well" : "Other models you have",
		};
	});
}

const ADDRESS_ERROR = "Use an address that starts with http:// or https://.";

function isHttpAddress(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * When Night Shift searches by meaning, and which Ollama does it: a second
 * menu, like the effort of an agent. The settings are `ollama` and
 * `ollamaAddress`. An empty address is the Ollama on this computer.
 */
function SearchRunsOn({ data }: { data: SettingsView }) {
	const id = useId();
	const saveNow = useSaveNow();
	const saved = data.values.ollamaAddress.trim();
	const [asking, setAsking] = useState(false);
	const [address, setAddress] = useState(saved);
	const mode = data.values.ollama;
	const label = mode === "off" ? "Off" : saved || "This computer";
	const typed = address.trim();
	const invalid = typed !== "" && !isHttpAddress(typed);
	const ask = () => {
		setAddress(saved);
		setAsking(true);
	};
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<InputGroupButton
							className="min-w-0 shrink font-normal text-muted-foreground"
							aria-label={`Search by meaning: ${label}. Choose when and where it runs.`}
						>
							<span className="truncate">{label}</span>
							<ChevronDownIcon />
						</InputGroupButton>
					}
				/>
				<DropdownMenuContent align="start" className="w-72">
					<DropdownMenuGroup>
						<DropdownMenuLabel>Search by meaning</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							value={mode}
							onValueChange={(next: string) =>
								saveNow({ ollama: next as typeof mode })
							}
						>
							{ollamaModes(data.values.host).map((option) => (
								<DropdownMenuRadioItem
									key={option.value}
									value={option.value}
									closeOnClick
								>
									{option.label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
					<DropdownMenuSeparator />
					<DropdownMenuGroup>
						<DropdownMenuLabel>Ollama runs on</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							value={saved ? "there" : "here"}
							onValueChange={(next: string) => {
								if (next === "here") saveNow({ ollamaAddress: "" });
								else ask();
							}}
						>
							<DropdownMenuRadioItem value="here" closeOnClick>
								This computer
							</DropdownMenuRadioItem>
							<DropdownMenuRadioItem value="there" closeOnClick>
								<span className="truncate">Another computer</span>
								{saved ? (
									<DropdownMenuShortcut className="truncate tracking-normal">
										{saved}
									</DropdownMenuShortcut>
								) : null}
							</DropdownMenuRadioItem>
						</DropdownMenuRadioGroup>
					</DropdownMenuGroup>
					{saved ? (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem onClick={ask}>
								Change the address…
							</DropdownMenuItem>
						</>
					) : null}
				</DropdownMenuContent>
			</DropdownMenu>
			<Dialog open={asking} onOpenChange={setAsking}>
				<DialogContent className="sm:max-w-sm">
					<form
						className="flex flex-col gap-4"
						onSubmit={(event) => {
							event.preventDefault();
							if (typed === "" || invalid) return;
							saveNow({ ollamaAddress: typed });
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
						<Field data-invalid={invalid ? true : undefined}>
							<FieldLabel htmlFor={id}>Ollama address</FieldLabel>
							<Input
								id={id}
								className="font-mono"
								placeholder="http://192.168.1.20:11434"
								autoComplete="off"
								spellCheck={false}
								aria-invalid={invalid ? true : undefined}
								value={address}
								onChange={(event) => setAddress(event.target.value)}
							/>
							{invalid ? <FieldError>{ADDRESS_ERROR}</FieldError> : null}
						</Field>
						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => setAsking(false)}
							>
								Cancel
							</Button>
							<Button type="submit" disabled={typed === "" || invalid}>
								Use this address
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}

/** How search by meaning is now: off, ready, or what its Ollama lacks. */
function SearchState({ data }: { data: SettingsView }) {
	const status = useOllamaStatus();
	if (data.values.ollama === "off") {
		return (
			<State problem="Off" detail="Search finds files by their words only." />
		);
	}
	const s = status.data;
	if (!s) return <Skeleton className="ml-auto h-5 w-16" />;
	if (s.missingSecrets.length > 0) {
		return (
			<State
				problem="Needs a secret"
				detail={`Save the secret ${s.missingSecrets.join(", ")} on the Secrets page.`}
			/>
		);
	}
	if (!s.answers) {
		return (
			<State
				problem="Does not answer"
				detail={
					s.where
						? `Ollama at ${s.where} does not answer. Check the address, and that Ollama runs there.`
						: s.installed
							? "Ollama does not answer. Start Ollama, or let Night Shift start it."
							: "Ollama is not on this computer. Install it from ollama.com, or use another address."
				}
			/>
		);
	}
	if (s.download?.running) {
		return (
			<State
				problem={`${s.download.percent ?? 0}%`}
				detail={`Night Shift downloads ${s.model}. Search finds words until it is ready.`}
			/>
		);
	}
	if (!s.hasModel) {
		return (
			<State
				problem="No model"
				detail={`Ollama does not have ${s.model}. Download it on the Models page of Settings.`}
			/>
		);
	}
	return <State problem={null} />;
}

/** Meaning search: its model, when it runs, and which Ollama does it. */
export function SearchTable({
	data,
	agentPicker,
}: {
	data: SettingsView;
	agentPicker: AgentPicker;
}) {
	const saveNow = useSaveNow();
	const options = useSearchOptions(data.values.embeddingModel);
	return (
		<AnswersTable
			first="Search"
			rows={[
				{
					key: "search",
					name: "Meaning search",
					job: "Finds knowledge by what it means.",
					answersWith: (
						<PickerFrame>
							{agentPicker({
								purpose: "run",
								agents: false,
								choice: {},
								onChoiceChange: () => {},
								models: {
									label: "Models for search",
									options,
									value: data.values.embeddingModel,
									onPick: (model) => {
										if (model) saveNow({ embeddingModel: model });
									},
								},
							})}
							<SearchRunsOn data={data} />
						</PickerFrame>
					),
					state: <SearchState data={data} />,
				},
			]}
		/>
	);
}
