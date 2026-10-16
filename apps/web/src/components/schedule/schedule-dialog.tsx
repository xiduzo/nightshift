import {
	cronError,
	cronToTimeAndDays,
	type JsonValue,
	type Schedule,
	timeAndDaysToCron,
} from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import { Input } from "@nightshift/ui/components/input";
import { Label } from "@nightshift/ui/components/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
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
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
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
					: "Enter a cron line."
				: cronProblem
					? `The cron line does not parse: ${cronProblem}`
					: missing.length > 0
						? `Fill in ${missing.map((input) => input.label || input.name).join(", ")}.`
						: badJson.length > 0
							? `Fix the JSON of ${badJson.map((input) => input.label || input.name).join(", ")}.`
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

	const toggleDay = (day: number) => {
		if (when.mode !== "simple") return;
		const days = when.days.includes(day)
			? when.days.filter((d) => d !== day)
			: [...when.days, day].sort((a, b) => a - b);
		setWhen({ ...when, days });
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
					The daemon starts the flow at these times, each run in a new worktree.
					Saved in <span className="font-mono">.nightshift/schedules.json</span>
					.
				</DialogDescription>
			</DialogHeader>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${id}-flow`}>Flow</Label>
				<NativeSelect
					id={`${id}-flow`}
					value={chosen}
					disabled={flowNames.length === 0}
					className="font-mono"
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
					<p className="text-destructive text-xs">
						This flow has errors: a start fails until they are fixed.
					</p>
				) : null}
			</div>

			<FlowInputFields
				idPrefix={id}
				inputs={inputs}
				values={values}
				onChange={setValues}
			/>

			<fieldset
				className="flex flex-col gap-2"
				aria-labelledby={`${id}-starts`}
			>
				<div className="flex items-center gap-2">
					<span id={`${id}-starts`} className="font-medium text-xs">
						Starts
					</span>
					<Button
						type="button"
						variant="link"
						size="xs"
						className="ml-auto h-auto px-0"
						aria-pressed={when.mode === "cron"}
						onClick={() => {
							if (when.mode === "simple") {
								setWhen({ mode: "cron", cron: cron ?? "0 22 * * *" });
							} else {
								const simple = cronToTimeAndDays(when.cron);
								setWhen(
									simple
										? { mode: "simple", ...simple }
										: { mode: "simple", time: DEFAULT_TIME, days: EVERY_DAY },
								);
							}
						}}
					>
						{when.mode === "simple"
							? "Advanced: cron line"
							: "Simple: time and days"}
					</Button>
				</div>
				{when.mode === "simple" ? (
					<div className="flex flex-col gap-2">
						<div className="flex items-center gap-2">
							<Label htmlFor={`${id}-time`} className="sr-only">
								Start time
							</Label>
							<Input
								id={`${id}-time`}
								type="time"
								value={when.time}
								className="h-7 w-28 font-mono tabular-nums"
								onChange={(event) =>
									setWhen({ ...when, time: event.target.value })
								}
							/>
							<span className="text-muted-foreground text-xs">on</span>
							<div className="ml-auto flex gap-1">
								<Button
									type="button"
									size="xs"
									variant="ghost"
									onClick={() => setWhen({ ...when, days: EVERY_DAY })}
								>
									Every day
								</Button>
								<Button
									type="button"
									size="xs"
									variant="ghost"
									onClick={() => setWhen({ ...when, days: WEEKDAYS })}
								>
									Weekdays
								</Button>
							</div>
						</div>
						<fieldset className="grid grid-cols-7 gap-1" aria-label="Days">
							{WEEK.map(({ day, short, long }) => {
								const on = when.days.includes(day);
								return (
									<Button
										key={day}
										type="button"
										size="xs"
										variant={on ? "default" : "outline"}
										aria-pressed={on}
										aria-label={long}
										onClick={() => toggleDay(day)}
									>
										{short}
									</Button>
								);
							})}
						</fieldset>
					</div>
				) : (
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={`${id}-cron`} className="sr-only">
							Cron line
						</Label>
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
						<p className="text-muted-foreground text-xs">
							Five fields: minute, hour, day of the month, month, day of the
							week. On the daemon's clock.
						</p>
					</div>
				)}
				<p
					id={`${id}-when`}
					aria-live="polite"
					className={
						cronProblem
							? "text-destructive text-xs"
							: "text-muted-foreground text-xs"
					}
				>
					{cronProblem ? (
						`Does not parse: ${cronProblem}`
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
						"This cron line never comes due."
					) : (
						" "
					)}
				</p>
			</fieldset>

			<div className="flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<Checkbox
						id={`${id}-stop`}
						checked={stop.on}
						onCheckedChange={(on) => setStop((current) => ({ ...current, on }))}
					/>
					<Label htmlFor={`${id}-stop`}>Stop at a time</Label>
					<Input
						type="time"
						value={stop.time}
						disabled={!stop.on}
						aria-label="Stop time"
						aria-invalid={stopInvalid}
						className="ml-auto h-7 w-28 font-mono tabular-nums"
						onChange={(event) =>
							setStop({ on: true, time: event.target.value })
						}
					/>
				</div>
				<p className="text-muted-foreground text-xs">
					{stop.on
						? `The first ${stop.time || "…"} after the start. No new step starts after it; the run then ends as stopped.`
						: "No stop time: each run goes until its flow ends."}
				</p>
			</div>

			<div className="flex flex-col gap-1.5">
				<Label htmlFor={`${id}-base`}>
					Start from
					<span className="text-muted-foreground">(optional)</span>
				</Label>
				<Input
					id={`${id}-base`}
					value={baseRef}
					placeholder="The current branch"
					className="font-mono"
					autoComplete="off"
					spellCheck={false}
					onChange={(event) => setBaseRef(event.target.value)}
				/>
			</div>

			<DialogFooter className="items-center">
				{problem ? (
					<p className="mr-auto text-muted-foreground text-xs">{problem}</p>
				) : null}
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={problem !== null || saving}>
					{saving ? "Saving…" : schedule ? "Save" : "Add schedule"}
				</Button>
			</DialogFooter>
		</form>
	);
}
