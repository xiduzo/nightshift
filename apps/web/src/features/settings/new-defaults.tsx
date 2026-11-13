/**
 * What new work starts with: the agent of a new Agent node, the decider of
 * a new Decision node, and the model and the Ollama of meaning search.
 * Each is a row with the agent picker, and a pick saves at once. This is
 * the one place of these settings.
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
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { InputGroupButton } from "@nightshift/ui/components/input-group";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ChevronDownIcon,
	DownloadIcon,
	RotateCcwIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	deciderQueries,
	harnessInfo,
	harnessQueries,
	KeyValueRows,
	profileQueries,
	recordFrom,
	rowsFrom,
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
import { SaveError } from "./components/setting-fields";
import {
	type SettingKey,
	type SettingsPatch,
	useSaveSettings,
} from "./hooks/use-settings-form";
import { ollamaModes, SHORTLIST, useOllamaStatus } from "./meaning-search";
import { PERMISSION_MODES } from "./permission-modes";
import { ollamaMutations, ollamaQueries } from "./queries";

/** The settings of the New nodes table, and of the Search table. */
export const NEW_NODE_KEYS = [
	"agentHarness",
	"agentModel",
	"agentPermissionMode",
	"decisionDecider",
] as const satisfies readonly SettingKey[];
export const SEARCH_KEYS = [
	"ollama",
	"embeddingModel",
	"ollamaAddress",
] as const satisfies readonly SettingKey[];

/**
 * "Reset to defaults" for one table, beside its title. It shows when a
 * setting of `keys` differs from its default.
 */
export function ResetDefaults({
	data,
	keys,
	title,
}: {
	data: SettingsView;
	keys: readonly SettingKey[];
	/** The table's name, in the toast. */
	title: string;
}) {
	const reset = useSaveSettings();
	const saved = keys.filter((key) => data.fields[key]?.source === "saved");
	if (saved.length === 0) return null;
	const patch = (value: (key: SettingKey) => unknown) =>
		Object.fromEntries(saved.map((key) => [key, value(key)])) as SettingsPatch;
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			disabled={reset.isPending}
			onClick={() => {
				const before = patch((key) => data.values[key]);
				reset.mutate(
					patch(() => null),
					{
						onSuccess: () =>
							toast.success(`${title} reset to defaults`, {
								action: {
									label: "Undo",
									onClick: () =>
										reset.mutate(before, {
											onError: (error) =>
												toast.error(`Not undone: ${error.message}`),
										}),
								},
							}),
						onError: (error) => toast.error(`Not reset: ${error.message}`),
					},
				);
			}}
		>
			{reset.isPending ? (
				<Spinner data-icon="inline-start" />
			) : (
				<RotateCcwIcon data-icon="inline-start" />
			)}
			Reset to defaults
		</Button>
	);
}

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
									<span className="text-muted-foreground text-xs">
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
	const [headers, setHeaders] = useState(false);
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
							<DropdownMenuItem onClick={() => setHeaders(true)}>
								Headers…
								{Object.keys(data.values.ollamaHeaders).length > 0 ? (
									<DropdownMenuShortcut className="tracking-normal">
										{Object.keys(data.values.ollamaHeaders).length}
									</DropdownMenuShortcut>
								) : null}
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
			{headers ? (
				<OllamaHeadersDialog
					saved={data.values.ollamaHeaders}
					onClose={() => setHeaders(false)}
				/>
			) : null}
		</>
	);
}

/**
 * The headers Night Shift sends to an Ollama on another computer, for a
 * proxy that asks for a key. A value names a secret as `${NAME}`.
 */
function OllamaHeadersDialog({
	saved,
	onClose,
}: {
	saved: Record<string, string>;
	onClose: () => void;
}) {
	const [rows, setRows] = useState(() => rowsFrom(saved));
	const save = useSaveSettings();
	const draft = recordFrom(rows);
	const changed = JSON.stringify(draft) !== JSON.stringify(saved);
	return (
		<Dialog open onOpenChange={(open) => (open ? null : onClose())}>
			<DialogContent className="sm:max-w-lg">
				<form
					className="flex flex-col gap-4"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						if (!changed || save.isPending) return;
						save.mutate(
							{ ollamaHeaders: draft },
							{
								onSuccess: () => {
									toast.success("Headers saved");
									onClose();
								},
							},
						);
					}}
				>
					<DialogHeader>
						<DialogTitle>Headers for Ollama</DialogTitle>
						<DialogDescription>
							For an Ollama behind a proxy that asks for a key.
						</DialogDescription>
					</DialogHeader>
					<Field>
						<KeyValueRows
							rows={rows}
							onChange={(next) => {
								save.reset();
								setRows(next);
							}}
							keyLabel="Header"
							keyPlaceholder="Authorization"
							valuePlaceholder="Bearer ${OLLAMA_TOKEN}"
							addLabel="Add header"
						/>
						<FieldDescription>
							Write a key as <span className="font-mono">${"{NAME}"}</span> and
							save its value on the Secrets page.
						</FieldDescription>
					</Field>
					<SaveError error={save.error} />
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={!changed || save.isPending}>
							{save.isPending ? <Spinner data-icon="inline-start" /> : null}
							Save headers
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

/** How search by meaning is now: off, ready, or what its Ollama lacks. */
function SearchState({ data }: { data: SettingsView }) {
	const status = useOllamaStatus();
	const pull = useMutation(
		ollamaMutations.pull({
			onError: (error) => toast.error(`Not downloaded: ${error.message}`),
		}),
	);
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
			<div className="flex items-center justify-end gap-2">
				<State
					problem="No model"
					detail={
						s.download?.error
							? `The download of ${s.model} stopped: ${s.download.error}`
							: `Ollama does not have ${s.model}. Download it to find files by meaning.`
					}
				/>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pull.isPending}
					onClick={() => pull.mutate({ model: s.model })}
				>
					{pull.isPending ? (
						<Spinner data-icon="inline-start" />
					) : (
						<DownloadIcon data-icon="inline-start" />
					)}
					Download
				</Button>
			</div>
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
	const [other, setOther] = useState(false);
	return (
		<>
			{other ? (
				<OtherSearchModelDialog
					initial={data.values.embeddingModel}
					onClose={() => setOther(false)}
					onPick={(model) => {
						saveNow({ embeddingModel: model });
						setOther(false);
					}}
				/>
			) : null}
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
										onOther: () => setOther(true),
									},
								})}
								<SearchRunsOn data={data} />
							</PickerFrame>
						),
						state: <SearchState data={data} />,
					},
				]}
			/>
		</>
	);
}

/** A model for search that the list does not hold: Ollama takes any embedding model it can download. */
function OtherSearchModelDialog({
	initial,
	onClose,
	onPick,
}: {
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
							Type the name of an embedding model Ollama can download. A new
							model prepares the search again.
						</DialogDescription>
					</DialogHeader>
					<Field>
						<FieldLabel htmlFor={id}>Model</FieldLabel>
						<Input
							id={id}
							className="font-mono"
							placeholder="qwen3-embedding:0.6b"
							autoComplete="off"
							spellCheck={false}
							value={model}
							onChange={(event) => setModel(event.target.value)}
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
