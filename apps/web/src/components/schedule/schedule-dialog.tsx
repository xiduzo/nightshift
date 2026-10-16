import {
	cronError,
	cronToTimeAndDays,
	type JsonValue,
	type Schedule,
	timeAndDaysToCron,
} from "@nightshift/flows";
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
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@nightshift/ui/components/tabs";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import {
	FlowInputFields,
	filledInputs,
	type InputTexts,
	jsonProblem,
	missingInputs,
} from "@/components/run/flow-input-fields";
import { useProjectFlows } from "@/hooks/use-project-flows";
import { formatDayTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

/** Monday first, the way a week reads. Day numbers as cron counts them: 0 is Sunday. */
const WEEK = [
	{ day: 1, short: "Mon", long: "Monday" },
	{ day: 2, short: "Tue", long: "Tuesday" },
	{ day: 3, short: "Wed", long: "Wednesday" },
	{ day: 4, short: "Thu", long: "Thursday" },
	{ day: 5, short: "Fri", long: "Friday" },
	{ day: 6, short: "Sat", long: "Saturday" },
	{ day: 0, short: "Sun", long: "Sunday" },
];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];
const DEFAULT_TIME = "22:00";
const DEFAULT_STOP = "07:00";

/** Stored values as field text: JSON values as pretty JSON. */
function textsOf(values: Readonly<Record<string, JsonValue>>): InputTexts {
	const texts: InputTexts = {};
	for (const [name, value] of Object.entries(values)) {
		if (value === null) continue;
		texts[name] =
			typeof value === "string" ? value : JSON.stringify(value, null, 2);
	}
	return texts;
}

/** A free schedule id for a flow: its name, else the name with a number. */
function freeId(flow: string, taken: readonly string[]): string {
	const base = flow.slice(0, 56) || "schedule";
	if (!taken.includes(base)) return base;
	for (let n = 2; ; n++) {
		const id = `${base}-${n}`;
		if (!taken.includes(id)) return id;
	}
}

/**
 * Adds or edits one schedule: the flow and its inputs, when it starts (a
 * time and days, or a cron line), when it stops, and the ref to start from.
 */
export function ScheduleDialog({
	open,
	onOpenChange,
	projectId,
	schedule,
	takenIds,
	saving,
	onSave,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	/** Null adds a new schedule. */
	schedule: Schedule | null;
	/** The ids of the other schedules. */
	takenIds: readonly string[];
	saving: boolean;
	onSave: (schedule: Schedule) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
				{open ? (
					<ScheduleForm
						projectId={projectId}
						schedule={schedule}
						takenIds={takenIds}
						saving={saving}
						onSave={onSave}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

type When =
	| { mode: "simple"; time: string; days: number[] }
	| { mode: "cron"; cron: string };

function initialWhen(schedule: Schedule | null): When {
	if (!schedule) return { mode: "simple", time: DEFAULT_TIME, days: EVERY_DAY };
	const simple = cronToTimeAndDays(schedule.cron);
	return simple
		? { mode: "simple", ...simple }
		: { mode: "cron", cron: schedule.cron };
}

function cronOf(when: When): string | null {
	if (when.mode === "cron") return when.cron.trim() || null;
	return timeAndDaysToCron({ time: when.time, days: when.days });
}

function ScheduleForm({
	projectId,
	schedule,
	takenIds,
	saving,
	onSave,
}: {
	projectId: string;
	schedule: Schedule | null;
	takenIds: readonly string[];
	saving: boolean;
	onSave: (schedule: Schedule) => void;
}) {
	const id = useId();
	const list = useQuery(orpc.flows.list.queryOptions({ input: { projectId } }));
	const project = useProjectFlows(projectId);
	const flowNames = (list.data ?? []).map((flow) => flow.name);
	const [flow, setFlow] = useState(schedule?.flow ?? "");
	// Until the person picks one: the first flow that runs.
	const chosen =
		flow ||
		list.data?.find((item) => item.errorCount === 0)?.name ||
		flowNames[0] ||
		"";
	const [values, setValues] = useState<InputTexts>(() =>
		textsOf(schedule?.inputs ?? {}),
	);
	const [when, setWhen] = useState<When>(() => initialWhen(schedule));
	const [stop, setStop] = useState(() => ({
		on: schedule ? schedule.stopAt !== undefined : true,
		time: schedule?.stopAt ?? DEFAULT_STOP,
	}));
	const [baseRef, setBaseRef] = useState(schedule?.baseRef ?? "");

	const inputs = project.flows?.[chosen]?.inputs ?? [];
	const chosenItem = list.data?.find((item) => item.name === chosen);
	const cron = cronOf(when);
	const cronProblem = cron === null ? null : cronError(cron);
	const preview = useQuery({
		...orpc.schedules.preview.queryOptions({ input: { cron: cron ?? "" } }),
		enabled: cron !== null && cronProblem === null,
	});
	const missing = missingInputs(inputs, values);
	const badJson = inputs.filter(
		(input) => jsonProblem(input, values[input.name]) !== null,
	);
	const stopInvalid = stop.on && !/^([01]\d|2[0-3]):[0-5]\d$/.test(stop.time);
	const problem =
		chosen === ""
			? "Choose a flow."
			: cron === null
				? when.mode === "simple"
					? "Choose a time and at least one day."
					: "Enter a cron expression."
				: cronProblem
					? `This cron expression is not valid: ${cronProblem}`
					: missing.length > 0
						? `Fill in ${missing.map((input) => input.label || input.name).join(", ")}.`
						: badJson.length > 0
							? `Check the format of ${badJson.map((input) => input.label || input.name).join(", ")}.`
							: stopInvalid
								? "Enter a stop time, for example 07:00."
								: null;

	const save = () => {
		if (problem !== null || cron === null || saving) return;
		const ref = baseRef.trim();
		onSave({
			id: schedule?.id ?? freeId(chosen, takenIds),
			flow: chosen,
			inputs: filledInputs(inputs, values),
			cron,
			...(stop.on ? { stopAt: stop.time } : {}),
			...(ref === "" ? {} : { baseRef: ref }),
			enabled: schedule?.enabled ?? true,
		});
	};

	/** Switches between time-and-days and a cron line, keeping what it can. */
	const setMode = (mode: When["mode"]) => {
		if (mode === when.mode) return;
		if (mode === "cron") {
			setWhen({ mode: "cron", cron: cron ?? "0 22 * * *" });
		} else if (when.mode === "cron") {
			const simple = cronToTimeAndDays(when.cron);
			setWhen(
				simple
					? { mode: "simple", ...simple }
					: { mode: "simple", time: DEFAULT_TIME, days: EVERY_DAY },
			);
		}
	};

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				save();
			}}
		>
			<DialogHeader>
				<DialogTitle>{schedule ? "Edit schedule" : "New schedule"}</DialogTitle>
				<DialogDescription>
					Choose a flow and when it runs. Night Shift starts it for you at those
					times.
				</DialogDescription>
			</DialogHeader>

			<FieldGroup className="gap-6">
				<Field
					data-invalid={
						(chosenItem !== undefined && chosenItem.errorCount > 0) || undefined
					}
				>
					<FieldLabel htmlFor={`${id}-flow`}>Flow</FieldLabel>
					<NativeSelect
						id={`${id}-flow`}
						value={chosen}
						disabled={flowNames.length === 0}
						className="w-full font-mono"
						onChange={(event) => setFlow(event.target.value)}
					>
						{flowNames.length === 0 ? (
							<NativeSelectOption value="">No flows yet</NativeSelectOption>
						) : null}
						{(list.data ?? []).map((item) => (
							<NativeSelectOption key={item.name} value={item.name}>
								{item.name}
								{item.errorCount > 0 ? " (has errors)" : ""}
							</NativeSelectOption>
						))}
					</NativeSelect>
					{chosenItem && chosenItem.errorCount > 0 ? (
						<FieldError>
							This flow has errors. Fix them, or the schedule cannot start it.
						</FieldError>
					) : null}
				</Field>

				<FlowInputFields
					idPrefix={id}
					inputs={inputs}
					values={values}
					onChange={setValues}
				/>

				<FieldSet className="gap-3">
					<FieldLegend variant="label" className="mb-0">
						When
					</FieldLegend>
					<Tabs
						value={when.mode}
						onValueChange={(mode) => setMode(mode as When["mode"])}
					>
						<TabsList className="w-full">
							<TabsTrigger value="simple">Time and days</TabsTrigger>
							<TabsTrigger value="cron">Cron</TabsTrigger>
						</TabsList>
						<TabsContent value="simple" className="flex flex-col gap-3 pt-1">
							{when.mode === "simple" ? (
								<>
									<div className="flex flex-wrap items-center gap-2">
										<FieldLabel htmlFor={`${id}-time`} className="sr-only">
											Start time
										</FieldLabel>
										<Input
											id={`${id}-time`}
											type="time"
											value={when.time}
											className="w-28 font-mono tabular-nums"
											onChange={(event) =>
												setWhen({ ...when, time: event.target.value })
											}
										/>
										<span className="text-muted-foreground text-sm">on</span>
										<div className="ml-auto flex gap-1">
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() => setWhen({ ...when, days: EVERY_DAY })}
											>
												Every day
											</Button>
											<Button
												type="button"
												size="sm"
												variant="ghost"
												onClick={() => setWhen({ ...when, days: WEEKDAYS })}
											>
												Weekdays
											</Button>
										</div>
									</div>
									<ToggleGroup
										multiple
										variant="outline"
										size="sm"
										spacing={0}
										aria-label="Days"
										className="w-full"
										value={when.days.map(String)}
										onValueChange={(days) =>
											setWhen({
												...when,
												days: days.map(Number).sort((a, b) => a - b),
											})
										}
									>
										{WEEK.map(({ day, short, long }) => (
											<ToggleGroupItem
												key={day}
												value={String(day)}
												aria-label={long}
												className="flex-1 aria-pressed:bg-primary aria-pressed:text-primary-foreground"
											>
												{short}
											</ToggleGroupItem>
										))}
									</ToggleGroup>
								</>
							) : null}
						</TabsContent>
						<TabsContent value="cron" className="pt-1">
							{when.mode === "cron" ? (
								<Field data-invalid={cronProblem !== null || undefined}>
									<FieldLabel htmlFor={`${id}-cron`} className="sr-only">
										Cron expression
									</FieldLabel>
									<Input
										id={`${id}-cron`}
										value={when.cron}
										placeholder="0 22 * * 1-5"
										className="font-mono"
										autoComplete="off"
										spellCheck={false}
										aria-invalid={cronProblem !== null}
										aria-describedby={`${id}-when`}
										onChange={(event) =>
											setWhen({ mode: "cron", cron: event.target.value })
										}
									/>
									<FieldDescription>
										For example, 0 22 * * 1-5 runs at 22:00 on weekdays. Times
										are in this computer's time zone.
									</FieldDescription>
								</Field>
							) : null}
						</TabsContent>
					</Tabs>
					<FieldDescription
						id={`${id}-when`}
						aria-live="polite"
						className={cronProblem ? "text-destructive" : undefined}
					>
						{cronProblem ? (
							`Not valid: ${cronProblem}`
						) : preview.data && preview.data.times.length > 0 ? (
							<>
								<span className="text-foreground">
									{preview.data.description}
								</span>
								. Next:{" "}
								{preview.data.times.map((time, index) => (
									<span key={time}>
										{index > 0 ? ", " : null}
										<time dateTime={new Date(time).toISOString()}>
											{formatDayTime(time)}
										</time>
									</span>
								))}
							</>
						) : preview.data ? (
							"This schedule never runs."
						) : (
							" "
						)}
					</FieldDescription>
				</FieldSet>

				<Field
					orientation="horizontal"
					data-invalid={stopInvalid || undefined}
					className="items-start"
				>
					<Switch
						id={`${id}-stop`}
						checked={stop.on}
						className="mt-0.5"
						onCheckedChange={(on) => setStop((current) => ({ ...current, on }))}
					/>
					<FieldContent>
						<FieldLabel htmlFor={`${id}-stop`}>Stop by a set time</FieldLabel>
						<FieldDescription>
							{stop.on
								? `After ${stop.time || "…"}, the run starts no new steps and stops.`
								: "Each run continues until the flow is done."}
						</FieldDescription>
					</FieldContent>
					<Input
						type="time"
						value={stop.time}
						disabled={!stop.on}
						aria-label="Stop time"
						aria-invalid={stopInvalid}
						className="w-28 shrink-0 font-mono tabular-nums"
						onChange={(event) =>
							setStop({ on: true, time: event.target.value })
						}
					/>
				</Field>

				<Field>
					<FieldLabel htmlFor={`${id}-base`}>
						Start from
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
					</FieldLabel>
					<Input
						id={`${id}-base`}
						value={baseRef}
						placeholder="The current branch"
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						onChange={(event) => setBaseRef(event.target.value)}
					/>
				</Field>
			</FieldGroup>

			<DialogFooter className="items-center">
				{problem ? (
					<p className="text-muted-foreground text-xs sm:mr-auto">{problem}</p>
				) : null}
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={problem !== null || saving}>
					{saving ? <Spinner data-icon="inline-start" /> : null}
					{saving ? "Saving…" : schedule ? "Save" : "Add schedule"}
				</Button>
			</DialogFooter>
		</form>
	);
}
