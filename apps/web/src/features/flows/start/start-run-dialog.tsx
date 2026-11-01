import {
	defaultPlacement,
	filledInputs,
	type InputTexts,
	inputProblem,
	missingInputs,
	placementChoices,
	useRunActed,
	waitedText,
} from "@nightshift/client";
import type { FlowInputDef } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
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
	Field,
	FieldContent,
	FieldDescription,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
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
import { PlayIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { runMutations, runQueries } from "@/features/runs/flows-port";
import { orpc } from "@/shared/api";
import {
	dayWord,
	formatDayTime,
	nextOccurrence,
	useNow,
} from "@/shared/format";
import { LocalTime } from "@/shared/time";
import { BaseRefCombobox } from "./base-ref-combobox";
import { FlowInputFields } from "./flow-input-fields";
import { placementDescription } from "./placement-words";

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

/**
 * Starts a flow file in a new worktree: its inputs, the ref to start from,
 * and an optional stop time.
 */
/** The runs whose branches "Start from" offers. */
const RECENT_RUNS = 12;

export function StartRunDialog({
	open,
	onOpenChange,
	projectId,
	flowName,
	inputs = [],
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	flowName: string;
	/** The flow's inputs, asked before the start. */
	inputs?: FlowInputDef[];
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
				{open ? (
					<StartRunForm
						projectId={projectId}
						flowName={flowName}
						inputs={inputs}
						onStarted={() => onOpenChange(false)}
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
}: {
	projectId: string;
	flowName: string;
	inputs: FlowInputDef[];
	onStarted: () => void;
}) {
	const id = useId();
	const navigate = useNavigate();
	const runActed = useRunActed({ orpc });
	const [stop, setStop] = useState(readStoredStop);
	const [values, setValues] = useState(() =>
		readStoredInputs(projectId, flowName, inputs),
	);
	const [baseRef, setBaseRef] = useState("");
	// Where the steps run: this computer when it has the project, else the
	// device of the project's latest run, else one of the person's own. A
	// Host another person owns that offers them nothing is no default.
	const placements = useQuery(runQueries.placements(projectId));
	const [chosenDevice, setChosenDevice] = useState<string | null>(null);
	const devices = placements.data ?? [];
	const device =
		defaultPlacement(placementChoices(devices), chosenDevice) ?? undefined;
	// One choice that is this computer: nothing to ask.
	const askDevice = devices.length > 1 || (device && !device.thisDevice);
	const noDevice = placements.isSuccess && devices.length === 0;
	const now = useNow(15_000);
	// Recent branches of this project's runs: a night can go on from an open stack.
	const runs = useQuery(runQueries.ofProject(projectId, RECENT_RUNS));
	const recentRefs = [
		...new Set((runs.data ?? []).flatMap((run) => [run.branch, run.baseRef])),
	].slice(0, 12);
	const lastBase = runs.data?.[0]?.baseRef;

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
			onSuccess: (run) => {
				onStarted();
				runActed(run.id);
				void navigate({ to: "/runs/$runId", params: { runId: run.id } });
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
		const ref = baseRef.trim();
		// Computed at the click, so a dialog left open does not start with a stale time.
		const at = stop.on ? nextOccurrence(stop.time) : null;
		startRun.mutate({
			projectId,
			flowName,
			...(Object.keys(filled).length === 0 ? {} : { inputs: filled }),
			...(ref === "" ? {} : { baseRef: ref }),
			...(at === null ? {} : { stopAt: at }),
			...(device && !device.thisDevice ? { deviceId: device.deviceId } : {}),
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
			<DialogHeader>
				<DialogTitle>
					Run <span className="font-mono">{flowName}</span>
				</DialogTitle>
				<DialogDescription>
					The run works on a new branch in its own copy of the project. You can
					stop it at any time.
				</DialogDescription>
			</DialogHeader>

			<FieldGroup className="gap-6">
				<FlowInputFields
					idPrefix={id}
					inputs={inputs}
					values={values}
					onChange={setValues}
				/>

				{inputs.length > 0 ? <FieldSeparator /> : null}

				{askDevice || noDevice ? (
					<Field data-invalid={noDevice || undefined}>
						<FieldLabel htmlFor={`${id}-device`}>Device</FieldLabel>
						<Select
							items={devices.map((d) => ({
								value: d.deviceId,
								label: placementLabel(d),
							}))}
							value={device?.deviceId ?? null}
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

				<Field>
					<FieldLabel htmlFor={`${id}-base`}>
						Start from
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
					</FieldLabel>
					<BaseRefCombobox
						id={`${id}-base`}
						projectId={projectId}
						value={baseRef}
						recent={recentRefs}
						placeholder={
							lastBase
								? `The current branch (last: ${lastBase})`
								: "The current branch"
						}
						describedBy={`${id}-base-hint`}
						onChange={setBaseRef}
					/>
					<FieldDescription id={`${id}-base-hint`}>
						A branch, tag or commit, for example the top of an open stack.
					</FieldDescription>
				</Field>

				<Field
					orientation="horizontal"
					data-invalid={stopInvalid || undefined}
					className="items-start"
				>
					<Switch
						id={`${id}-on`}
						checked={stop.on}
						className="mt-0.5"
						onCheckedChange={(on) => setStop((current) => ({ ...current, on }))}
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
			</FieldGroup>

			<DialogFooter>
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
					) : (
						<PlayIcon data-icon="inline-start" />
					)}
					{startRun.isPending ? "Starting…" : "Start"}
				</Button>
			</DialogFooter>
		</form>
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
