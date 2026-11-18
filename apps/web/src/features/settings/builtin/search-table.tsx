/**
 * Search by meaning: its model, when it runs, and the Ollama that does
 * it. Each is a row with the agent picker, and a pick saves at once.
 * This is the one place of these settings.
 */
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
import { ChevronDownIcon, DownloadIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { KeyValueRows, recordFrom, rowsFrom } from "@/features/agents";
import type { SettingsView } from "@/shared/api";
import { SaveError, type SettingKey, useSaveSettings } from "../form";
import { ollamaMutations, ollamaQueries } from "../queries";
import {
	type AgentPicker,
	AnswersTable,
	type ModelOption,
	PickerFrame,
	State,
	useSaveNow,
} from "./answers-table";
import { ollamaModes, SHORTLIST, useOllamaStatus } from "./meaning-search";

/** The settings of the Search table. */
export const SEARCH_KEYS = [
	"ollama",
	"embeddingModel",
	"ollamaAddress",
] as const satisfies readonly SettingKey[];

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
