import {
	cronError,
	cronToTimeAndDays,
	type FlowInputDef,
	type JsonValue,
	type Schedule,
	timeAndDaysToCron,
	webhookSecretName,
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
	BaseRefCombobox,
	FlowInputFields,
	filledInputs,
	flowQueries,
	type InputTexts,
	jsonProblem,
	missingInputs,
} from "@/features/flows";
import { formatDayTime } from "@/shared/format";
import { scheduleQueries } from "./queries";
import {
	WebhookFields,
	type WebhookForm,
	webhookAddress,
} from "./webhook-fields";

/** The flow choice of a webhook that starts no flow: it only wakes waiting runs. */
const NO_FLOW = "-";

/** The way a webhook's input value reads the webhook: `{{event.…}}`. */
const isTemplate = (text: string) => text.includes("{{");

/**
 * A webhook schedule's values: a template stays text, to render when the
 * webhook arrives; other JSON text is parsed. Only the ones filled in.
 */
function webhookInputs(
	inputs: readonly FlowInputDef[],
	values: InputTexts,
): Record<string, JsonValue> {
	const filled: Record<string, JsonValue> = {};
	for (const input of inputs) {
		const text = values[input.name]?.trim() ?? "";
		if (text === "") continue;
		filled[input.name] =
			input.type === "json" && !isTemplate(text)
				? (JSON.parse(text) as JsonValue)
				: text;
	}
	return filled;
}

function initialWebhook(schedule: Schedule | null): WebhookForm {
	return {
		secret: webhookSecretName(schedule?.webhook?.secret ?? "") ?? "",
		when: schedule?.webhook?.when ?? "",
		signal: {
			on: schedule?.signal !== undefined,
			name: schedule?.signal?.name ?? "",
			key: schedule?.signal?.key ?? "",
		},
	};
}

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
	if (!schedule?.cron) {
		return { mode: "simple", time: DEFAULT_TIME, days: EVERY_DAY };
	}
	const simple = cronToTimeAndDays(schedule.cron);
	return simple
		? { mode: "simple", ...simple }
		: { mode: "cron", cron: schedule.cron };
}

function cronOf(when: When): string | null {
	if (when.mode === "cron") return when.cron.trim() || null;
	return timeAndDaysToCron({ time: when.time, days: when.days });
}

/** What starts the schedule: a time, or a webhook. */
type Trigger = "times" | "webhook";

/** Why the webhook part cannot be saved, or null. */
function webhookProblem(webhook: WebhookForm, startsFlow: boolean) {
	if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(webhook.secret)) {
		return "Enter the name of a secret, for example GITHUB_HOOK_SECRET.";
	}
	if (
		webhook.signal.on &&
		!/^[a-z][a-z0-9-]{0,29}$/.test(webhook.signal.name)
	) {
		return "Name the signal with lowercase letters, digits and -, for example ci-done.";
	}
	if (!startsFlow && !webhook.signal.on) {
		return "Choose a flow, or wake waiting runs.";
	}
	return null;
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
	const list = useQuery(flowQueries.list(projectId));
	const flowNames = (list.data ?? []).map((flow) => flow.name);
	const [trigger, setTrigger] = useState<Trigger>(
		schedule?.webhook ? "webhook" : "times",
	);
	const [webhook, setWebhook] = useState(() => initialWebhook(schedule));
	const [flow, setFlow] = useState(schedule ? (schedule.flow ?? NO_FLOW) : "");
	// No flow: a webhook that only wakes waiting runs.
	const startsFlow = !(trigger === "webhook" && flow === NO_FLOW);
	// Until the person picks one: the first flow that runs.
	const chosen =
		(flow === NO_FLOW ? "" : flow) ||
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

	const chosenItem = startsFlow
		? list.data?.find((item) => item.name === chosen)
		: undefined;
	const inputs = chosenItem?.inputs ?? [];
	const cron = trigger === "times" ? cronOf(when) : null;
	const cronProblem = cron === null ? null : cronError(cron);
	const preview = useQuery({
		...scheduleQueries.preview(cron ?? ""),
		enabled: cron !== null && cronProblem === null,
	});
	const missing = missingInputs(inputs, values);
	const badJson = inputs.filter((input) => {
		const text = values[input.name];
		if (trigger === "webhook" && text && isTemplate(text)) return false;
		return jsonProblem(input, text) !== null;
	});
	const stopInvalid = stop.on && !/^([01]\d|2[0-3]):[0-5]\d$/.test(stop.time);
	const whenProblem =
		trigger === "webhook"
			? webhookProblem(webhook, startsFlow)
			: cron === null
				? when.mode === "simple"
					? "Choose a time and at least one day."
					: "Enter a cron expression."
				: cronProblem
					? `This cron expression is not valid: ${cronProblem}`
					: null;
	const problem =
		startsFlow && chosen === ""
			? "Choose a flow."
			: (whenProblem ??
				(missing.length > 0
					? `Fill in ${missing.map((input) => input.label || input.name).join(", ")}.`
					: badJson.length > 0
						? `Check the format of ${badJson.map((input) => input.label || input.name).join(", ")}.`
						: stopInvalid
							? "Enter a stop time, for example 07:00."
							: null));

	const scheduleId =
		schedule?.id ??
		freeId(startsFlow ? chosen : webhook.signal.name || "webhook", takenIds);

	const save = () => {
		if (problem !== null || saving) return;
		const ref = baseRef.trim();
		const shared = {
			id: scheduleId,
			...(stop.on ? { stopAt: stop.time } : {}),
			...(ref === "" ? {} : { baseRef: ref }),
			enabled: schedule?.enabled ?? true,
		};
		if (trigger === "times") {
			if (cron === null) return;
			onSave({
				...shared,
				flow: chosen,
				inputs: filledInputs(inputs, values),
				cron,
			});
			return;
		}
		const rule = webhook.when.trim();
		const key = webhook.signal.key.trim();
		onSave({
			...shared,
			...(startsFlow ? { flow: chosen } : {}),
			inputs: startsFlow ? webhookInputs(inputs, values) : {},
			webhook: {
				secret: `\${${webhook.secret}}`,
				...(rule === "" ? {} : { when: rule }),
			},
			...(webhook.signal.on
				? {
						signal: {
							name: webhook.signal.name,
							...(key === "" ? {} : { key }),
						},
					}
				: {}),
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
					Choose a flow and when it runs. Night Shift starts it for you at set
					times, or when a webhook arrives.
				</DialogDescription>
			</DialogHeader>

			<FieldGroup className="gap-6">
				<Tabs
					value={trigger}
					onValueChange={(value) => setTrigger(value as Trigger)}
				>
					<TabsList className="w-full" aria-label="When it starts">
						<TabsTrigger value="times">At set times</TabsTrigger>
						<TabsTrigger value="webhook">When a webhook arrives</TabsTrigger>
					</TabsList>
				</Tabs>

				<Field
					data-invalid={
						(chosenItem !== undefined && chosenItem.errorCount > 0) || undefined
					}
				>
					<FieldLabel htmlFor={`${id}-flow`}>Flow</FieldLabel>
					<NativeSelect
						id={`${id}-flow`}
						value={startsFlow ? chosen : NO_FLOW}
						disabled={flowNames.length === 0 && trigger === "times"}
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
						{trigger === "webhook" ? (
							<NativeSelectOption value={NO_FLOW}>
								No flow, only wake waiting runs
							</NativeSelectOption>
						) : null}
					</NativeSelect>
					{chosenItem && chosenItem.errorCount > 0 ? (
						<FieldError>
							This flow has errors. Fix them, or the schedule cannot start it.
						</FieldError>
					) : null}
				</Field>

				{trigger === "webhook" && inputs.length > 0 ? (
					<FieldDescription className="-mb-3">
						A value can read the webhook, for example{" "}
						<code className="font-mono">{"{{event.body.number}}"}</code> or{" "}
						<code className="font-mono">
							{"{{event.headers.x-github-event}}"}
						</code>
						.
					</FieldDescription>
				) : null}
				<FlowInputFields
					idPrefix={id}
					inputs={inputs}
					values={values}
					onChange={setValues}
					templates={trigger === "webhook"}
				/>

				{trigger === "webhook" ? (
					<WebhookFields
						idPrefix={id}
						address={webhookAddress(projectId, scheduleId)}
						value={webhook}
						onChange={setWebhook}
					/>
				) : null}

				{trigger === "times" ? (
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
				) : null}

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
					<BaseRefCombobox
						id={`${id}-base`}
						projectId={projectId}
						value={baseRef}
						placeholder="The current branch"
						onChange={setBaseRef}
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
