import {
	type FlowUse,
	filledInputs,
	type InputTexts,
	inputProblem,
	missingInputs,
	rankFlowsByUse,
	useRunActed,
	waitedText,
} from "@nightshift/client";
import type { FlowInputDef } from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Button } from "@nightshift/ui/components/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@nightshift/ui/components/combobox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	FlaskConicalIcon,
	HistoryIcon,
	PlayIcon,
	WorkflowIcon,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import { useHasFolder } from "@/features/projects";
import { runMutations, runQueries } from "@/features/runs/flows-port";
import { orpc } from "@/shared/api";
import {
	dayWord,
	formatDayTime,
	nextOccurrence,
	useNow,
} from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { outcomeLabel } from "../canvas/outcome-badge";
import {
	markCount,
	marksText,
	type TestMarks,
	testRequest,
} from "../editor/test-run/marks";
import { flowQueries } from "../queries";
import { StartFromField } from "./base-ref-combobox";
import { FlowInputFields } from "./flow-input-fields";
import { placementDescription } from "./placement-words";

/** The Device field's choice for no device: the flow says where the run goes. */
const AUTOMATIC = "__automatic__";

const STORAGE_KEY = "nightshift:stop-time";
const DEFAULT_TIME = "07:00";

type StoredStop = { on: boolean; time: string };

/** The stop time of the last start. Storage can be missing or blocked. */
function readStoredStop(): StoredStop {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<StoredStop>;
			if (typeof parsed.time === "string" && typeof parsed.on === "boolean") {
				return { on: parsed.on, time: parsed.time };
			}
		}
	} catch {
		// Fall through to the default.
	}
	return { on: false, time: DEFAULT_TIME };
}

function writeStoredStop(stop: StoredStop) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stop));
	} catch {
		// Not remembered; the dialog still works.
	}
}

type InputValues = InputTexts;

function inputsKey(projectId: string, flowName: string) {
	return `nightshift:inputs:${projectId}:${flowName}`;
}

/** Before inputs: run parameters, by the same names. */
function legacyKey(projectId: string, flowName: string) {
	return `nightshift:params:${projectId}:${flowName}`;
}

/** The values of the last start of this flow, for the names it still declares. */
function readStoredInputs(
	projectId: string,
	flowName: string,
	inputs: FlowInputDef[],
): InputValues {
	const values: InputValues = {};
	try {
		const raw =
			window.localStorage.getItem(inputsKey(projectId, flowName)) ??
			window.localStorage.getItem(legacyKey(projectId, flowName));
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (parsed && typeof parsed === "object") {
			for (const { name } of inputs) {
				const value = (parsed as Record<string, unknown>)[name];
				if (typeof value === "string") values[name] = value;
			}
		}
	} catch {
		// Start with empty fields.
	}
	return values;
}

function writeStoredInputs(
	projectId: string,
	flowName: string,
	values: InputValues,
) {
	try {
		window.localStorage.setItem(
			inputsKey(projectId, flowName),
			JSON.stringify(values),
		);
	} catch {
		// Not remembered; the dialog still works.
	}
}

/** Only what was filled in, as typed, to remember for the next start. */
function typedInputs(inputs: FlowInputDef[], values: InputValues): InputValues {
	const typed: InputValues = {};
	for (const { name } of inputs) {
		const text = values[name]?.trim() ?? "";
		if (text !== "") typed[name] = text;
	}
	return typed;
}

/** The pins and skips of a test run, from the editor (ADR 27). */
export type StartTest = {
	marks: TestMarks;
	/** The skipped nodes that are Gates: nobody answers them. */
	skippedGates: readonly string[];
	/** The test run started: the editor shows what it gives. */
	onStarted: (runId: string) => void;
};

/**
 * Starts a flow file in a new worktree: its inputs, the ref to start from,
 * and an optional stop time. A project without a folder has no ref to
 * start from. With `test`, the editor's pins and skips: a test run, unless
 * the person turns them off.
 */
export function StartRunDialog({
	open,
	onOpenChange,
	projectId,
	flowName,
	inputs = [],
	test,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	flowName: string;
	/** The flow's inputs, asked before the start. */
	inputs?: FlowInputDef[];
	/** The editor's pins and skips. The Flows page never sends them. */
	test?: StartTest;
}) {
	// Inputs or pins to show: the wide, two-column layout of the quick run.
	const wide = inputs.length > 0 || test !== undefined;
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				className={
					wide
						? "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg md:max-w-3xl lg:max-w-5xl xl:max-w-6xl"
						: "max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
				}
			>
				{open ? (
					<StartRunForm
						projectId={projectId}
						flowName={flowName}
						inputs={inputs}
						onStarted={() => onOpenChange(false)}
						test={test}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function StartRunForm({
	projectId,
	flowName,
	inputs,
	onStarted,
	picker,
	test,
}: {
	projectId: string;
	flowName: string;
	inputs: FlowInputDef[];
	onStarted: () => void;
	/** A field that chooses the flow. With it, the form has no header of its own. */
	picker?: ReactNode;
	test?: StartTest;
}) {
	const id = useId();
	const navigate = useNavigate();
	const runActed = useRunActed({ orpc });
	const [stop, setStop] = useState(readStoredStop);
	// Fields start empty. The values of the last start wait behind a button.
	const [lastValues] = useState(() =>
		readStoredInputs(projectId, flowName, inputs),
	);
	const [values, setValues] = useState<InputValues>({});
	const canReuse =
		Object.keys(lastValues).length > 0 &&
		inputs.some(
			({ name }) => (values[name] ?? "") !== (lastValues[name] ?? ""),
		);
	const [baseRef, setBaseRef] = useState("");
	const [usesMarks, setUsesMarks] = useState(true);
	const testing = test !== undefined && usesMarks;
	// A project without a folder has no branches: nothing to start from.
	const withFolder = useHasFolder(projectId);
	// Where the steps run: Automatic lets the flow decide. A device the person
	// picks goes first, and the flow's devices are its backups.
	const placements = useQuery(runQueries.placements(projectId));
	const [chosenDevice, setChosenDevice] = useState<string>(AUTOMATIC);
	const devices = placements.data ?? [];
	const device = devices.find((d) => d.deviceId === chosenDevice);
	// One choice that is this computer: nothing to ask.
	const askDevice = devices.length > 1 || devices[0]?.thisDevice === false;
	const noDevice = placements.isSuccess && devices.length === 0;
	const now = useNow(15_000);

	const stopAt = stop.on ? nextOccurrence(stop.time, now) : null;
	const missing = missingInputs(inputs, values);
	const badInputs = inputs.filter(
		(input) => inputProblem(input, values[input.name]) !== null,
	);
	const stopInvalid = stop.on && stopAt === null;
	const invalid =
		stopInvalid || missing.length > 0 || badInputs.length > 0 || noDevice;

	const startRun = useMutation(
		runMutations.start({
			onSuccess: (run, start) => {
				onStarted();
				runActed(run.id);
				const open = () =>
					void navigate({ to: "/runs/$runId", params: { runId: run.id } });
				// A test run keeps you in the editor, which shows what it gives.
				if ("test" in start && start.test !== undefined) {
					test?.onStarted(run.id);
					toast.success("Test run started", {
						action: { label: "Open the run", onClick: open },
					});
					return;
				}
				open();
			},
			onError: (error) => toast.error(`Could not start: ${error.message}`),
		}),
	);

	const start = () => {
		if (invalid || startRun.isPending) return;
		writeStoredStop(stop);
		const filled = filledInputs(inputs, values);
		if (inputs.length > 0)
			writeStoredInputs(projectId, flowName, typedInputs(inputs, values));
		const ref = withFolder ? baseRef.trim() : "";
		// Computed at the click, so a dialog left open does not start with a stale time.
		const at = stop.on ? nextOccurrence(stop.time) : null;
		const marks = testing ? testRequest(test.marks) : undefined;
		startRun.mutate({
			projectId,
			flowName,
			...(Object.keys(filled).length === 0 ? {} : { inputs: filled }),
			...(ref === "" ? {} : { baseRef: ref }),
			...(at === null ? {} : { stopAt: at }),
			...(device ? { deviceId: device.deviceId } : {}),
			...(marks ? { test: marks } : {}),
		});
	};

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				start();
			}}
		>
			{picker ? null : (
				<DialogHeader>
					<DialogTitle>
						{testing ? "Test" : "Run"}{" "}
						<span className="font-mono">{flowName}</span>
					</DialogTitle>
					<DialogDescription>
						{withFolder
							? "The run works on a new branch in its own copy of the project. You can stop it at any time."
							: "You can stop the run at any time."}
					</DialogDescription>
				</DialogHeader>
			)}

			<SplitFields
				split={picker !== undefined || inputs.length > 0 || test !== undefined}
				main={
					<>
						{picker}
						{test ? (
							<div className="flex flex-col gap-3">
								<Field orientation="horizontal">
									<Switch
										id={`${id}-test`}
										checked={usesMarks}
										onCheckedChange={setUsesMarks}
									/>
									<FieldLabel htmlFor={`${id}-test`}>
										Use pins and skips
									</FieldLabel>
								</Field>
								{usesMarks ? <TestAlert test={test} /> : null}
							</div>
						) : null}
						<FlowInputFields
							idPrefix={id}
							inputs={inputs}
							values={values}
							onChange={setValues}
						/>
					</>
				}
				settings={
					<>
						{askDevice || noDevice ? (
							<Field data-invalid={noDevice || undefined}>
								<FieldLabel htmlFor={`${id}-device`}>Device</FieldLabel>
								<Select
									items={[
										{ value: AUTOMATIC, label: "Automatic" },
										...devices.map((d) => ({
											value: d.deviceId,
											label: placementLabel(d),
										})),
									]}
									value={device?.deviceId ?? AUTOMATIC}
									onValueChange={(value) => {
										if (value) setChosenDevice(value);
									}}
									disabled={noDevice}
								>
									<SelectTrigger
										id={`${id}-device`}
										className="w-full"
										aria-describedby={`${id}-device-hint`}
									>
										<SelectValue placeholder="No device" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={AUTOMATIC}>Automatic</SelectItem>
										{[
											{
												label: "Your devices",
												list: devices.filter((d) => d.offers === undefined),
											},
											{
												label: "Offered to this Space",
												list: devices.filter((d) => d.offers !== undefined),
											},
										].map((group) =>
											group.list.length === 0 ? null : (
												<SelectGroup key={group.label}>
													<SelectLabel>{group.label}</SelectLabel>
													{group.list.map((d) => (
														<SelectItem key={d.deviceId} value={d.deviceId}>
															{placementLabel(d)}
														</SelectItem>
													))}
												</SelectGroup>
											),
										)}
									</SelectContent>
								</Select>
								<FieldDescription
									id={`${id}-device-hint`}
									className={noDevice ? "text-destructive" : undefined}
								>
									{placementDescription(device, noDevice)}
								</FieldDescription>
							</Field>
						) : null}

						{withFolder ? (
							<StartFromField
								projectId={projectId}
								value={baseRef}
								onChange={setBaseRef}
							/>
						) : null}

						<Field
							orientation="horizontal"
							data-invalid={stopInvalid || undefined}
							className="items-start"
						>
							<Switch
								id={`${id}-on`}
								checked={stop.on}
								className="mt-0.5"
								onCheckedChange={(on) =>
									setStop((current) => ({ ...current, on }))
								}
							/>
							<FieldContent>
								<FieldLabel htmlFor={`${id}-on`}>Stop at a time</FieldLabel>
								<FieldDescription
									id={`${id}-hint`}
									aria-live="polite"
									className={stopInvalid ? "text-destructive" : undefined}
								>
									{!stop.on ? (
										"The run goes until the flow ends."
									) : stopAt === null ? (
										"Enter a time, for example 07:00."
									) : (
										<>
											Stops{" "}
											<LocalTime
												at={stopAt}
												className="font-medium text-foreground"
											>
												{dayWord(stopAt, now)}, {formatDayTime(stopAt)}
											</LocalTime>{" "}
											(in {waitedText(stopAt - now)}). No new step starts after
											that.
										</>
									)}
								</FieldDescription>
							</FieldContent>
							<Input
								id={`${id}-time`}
								type="time"
								value={stop.time}
								disabled={!stop.on}
								aria-label="Stop time"
								aria-invalid={stopInvalid}
								aria-describedby={`${id}-hint`}
								className="w-28 shrink-0 font-mono tabular-nums"
								onChange={(event) =>
									setStop({ on: true, time: event.target.value })
								}
							/>
						</Field>
					</>
				}
			/>

			<DialogFooter>
				{canReuse ? (
					<Button
						type="button"
						variant="ghost"
						className="sm:mr-auto"
						onClick={() => setValues({ ...values, ...lastValues })}
					>
						<HistoryIcon data-icon="inline-start" />
						Use last run's values
					</Button>
				) : null}
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button
					type="submit"
					disabled={invalid || startRun.isPending}
					title={
						noDevice
							? "None of your devices with this project is online."
							: missing.length > 0
								? `Fill in ${missing.map((input) => input.label || input.name).join(", ")} first.`
								: badInputs.length > 0
									? `Check the format of ${badInputs.map((input) => input.label || input.name).join(", ")} first.`
									: undefined
					}
				>
					{startRun.isPending ? (
						<Spinner data-icon="inline-start" />
					) : testing ? (
						<FlaskConicalIcon data-icon="inline-start" />
					) : (
						<PlayIcon data-icon="inline-start" />
					)}
					{startRun.isPending ? "Starting…" : testing ? "Start test" : "Start"}
				</Button>
			</DialogFooter>
		</form>
	);
}

/**
 * The fields of a start. Split: what to run on the left, how it runs on the
 * right, as in the quick run. Without anything on the left: one column.
 */
function SplitFields({
	split,
	main,
	settings,
}: {
	split: boolean;
	main: ReactNode;
	settings: ReactNode;
}) {
	if (!split) {
		return <FieldGroup className="gap-6">{settings}</FieldGroup>;
	}
	return (
		<div className="grid gap-6 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
			<FieldGroup className="gap-6">{main}</FieldGroup>
			<FieldGroup className="gap-6 border-t pt-6 md:border-t-0 md:border-l md:pt-0 md:pl-6">
				{settings}
			</FieldGroup>
		</div>
	);
}

/**
 * What a test run pins and skips, and what still runs for real: the steps
 * after a skipped Gate, such as a send, run without anyone's answer.
 */
function TestAlert({ test }: { test: StartTest }) {
	const pinned = Object.keys(test.marks.pinned);
	const skipped = Object.entries(test.marks.skipped);
	return (
		<Alert>
			<FlaskConicalIcon />
			<AlertTitle>{marksText(markCount(test.marks))}</AlertTitle>
			<AlertDescription>
				<ul className="flex flex-col gap-0.5">
					{pinned.length > 0 ? (
						<li>
							Pinned output:{" "}
							{pinned.map((nodeId, index) => (
								<span key={nodeId}>
									{index > 0 ? ", " : null}
									<code className="font-mono">{nodeId}</code>
								</span>
							))}
						</li>
					) : null}
					{skipped.length > 0 ? (
						<li>
							Skipped:{" "}
							{skipped.map(([nodeId, outcome], index) => (
								<span key={nodeId}>
									{index > 0 ? ", " : null}
									<code className="font-mono">{nodeId}</code> takes{" "}
									{outcomeLabel(outcome)}
								</span>
							))}
						</li>
					) : null}
				</ul>
				<p>
					{test.skippedGates.length > 0
						? "A skipped Gate does not ask. The steps after it run for real."
						: "Every other node runs for real."}
				</p>
			</AlertDescription>
		</Alert>
	);
}

/** A Device in the list: this computer, or another person's with what it offers. */
function placementLabel(d: {
	name: string;
	thisDevice: boolean;
	offers?: string[];
	lastRun?: boolean;
}): string {
	const name = d.thisDevice
		? `${d.name} (this computer)`
		: d.lastRun
			? `${d.name} (last run)`
			: d.name;
	if (d.offers === undefined) return name;
	return d.offers.length === 0
		? `${name} · offers nothing`
		: `${name} · offers ${d.offers.join(", ")}`;
}

/** Enough recent runs to count which flows were used lately. */
const USE_RUNS = 200;

/**
 * Starts one of the project's flows, chosen in a searchable list: the flow
 * half of a quick run. Only flows without errors are in the list, the ones
 * you started most in the last 30 days first. The parent keeps the choice,
 * so it stays when the person switches tabs.
 */
export function PickFlowRunForm({
	projectId,
	flowName,
	onFlowNameChange,
	onStarted,
}: {
	projectId: string;
	flowName: string | null;
	onFlowNameChange: (name: string) => void;
	onStarted: () => void;
}) {
	const id = useId();
	const flows = useQuery(flowQueries.list(projectId));
	const runs = useQuery({
		...runQueries.ofProject(projectId, USE_RUNS),
		meta: { quietErrors: true },
	});
	const now = useNow(60_000);
	const runnable = (flows.data ?? []).filter(
		(flow) => flow.nodeCount !== null && flow.errorCount === 0,
	);
	const byName = new Map(runnable.map((flow) => [flow.name, flow]));
	const ranked = rankFlowsByUse([...byName.keys()], runs.data ?? [], now);
	const useOf = new Map(ranked.map((flow) => [flow.name, flow.use]));
	const names = ranked.map((flow) => flow.name);
	const chosenName =
		flowName !== null && byName.has(flowName) ? flowName : names[0];
	const chosen = chosenName === undefined ? null : byName.get(chosenName);

	// The whole list on open; filter only once the person types.
	const [typed, setTyped] = useState<string | null>(null);
	const query = typed?.trim().toLowerCase() ?? "";
	const shown =
		query === ""
			? names
			: names.filter(
					(name) =>
						name.toLowerCase().includes(query) ||
						byName.get(name)?.description?.toLowerCase().includes(query),
				);

	if (flows.isPending) {
		return (
			<div className="flex justify-center py-8">
				<Spinner aria-label="Loading flows" />
			</div>
		);
	}

	if (!chosen) {
		return (
			<Empty className="border">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<WorkflowIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>No flow to run</EmptyTitle>
					<EmptyDescription>
						{flows.error
							? flows.error.message
							: "Create a flow on the Flows page, or run a prompt."}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<StartRunForm
			key={chosen.name}
			projectId={projectId}
			flowName={chosen.name}
			inputs={chosen.inputs}
			onStarted={onStarted}
			picker={
				<Field>
					<FieldLabel htmlFor={`${id}-flow`}>Flow</FieldLabel>
					<Combobox
						items={names}
						filteredItems={shown}
						filter={null}
						value={chosen.name}
						inputValue={typed ?? chosen.name}
						onInputValueChange={(next) => setTyped(next)}
						onValueChange={(next: string | null) => {
							if (next) onFlowNameChange(next);
							setTyped(null);
						}}
						onOpenChange={(open) => {
							if (!open) setTyped(null);
						}}
					>
						<ComboboxInput
							id={`${id}-flow`}
							className="w-full font-mono"
							placeholder="Search flows"
							autoComplete="off"
							spellCheck={false}
							aria-describedby={
								chosen.description ? `${id}-flow-hint` : undefined
							}
						/>
						<ComboboxContent>
							<ComboboxEmpty>No flow with that name.</ComboboxEmpty>
							<ComboboxList>
								{(name: string) => (
									<ComboboxItem key={name} value={name}>
										<span className="truncate font-mono">{name}</span>
										<FlowUseText use={useOf.get(name)} />
									</ComboboxItem>
								)}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
					{chosen.description ? (
						<FieldDescription id={`${id}-flow-hint`}>
							{chosen.description}
						</FieldDescription>
					) : null}
				</Field>
			}
		/>
	);
}

/** How often a flow ran in the last 30 days, at the end of its row. */
function FlowUseText({ use }: { use: FlowUse | undefined }) {
	if (!use || use.runs === 0) return null;
	const runs = use.runs === 1 ? "1 run" : `${use.runs} runs`;
	return (
		<span
			className="ml-auto shrink-0 text-muted-foreground text-xs tabular-nums"
			title={
				use.manual > 0
					? `${runs} in the last 30 days, ${use.manual} started by hand`
					: `${runs} in the last 30 days`
			}
		>
			{runs}
		</span>
	);
}
