import {
	cronToTimeAndDays,
	KNOWLEDGE_SOURCE_KINDS,
	type KnowledgeSource,
	type KnowledgeSourceKind,
	kitFlow,
	timeAndDaysToCron,
} from "@nightshift/flows";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
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
	FieldLegend,
	FieldSeparator,
	FieldSet,
	FieldTitle,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { UsersIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	FlowInputFields,
	type InputTexts,
	missingInputs,
} from "@/features/flows";
import { orpc } from "@/shared/api";
import { knowledgeMutations } from "./queries";

/** What each kind of source is, in one line, for the choice. */
const KIND_HINTS: Record<KnowledgeSourceKind["kit"], string> = {
	"kit:knowledge/folder": "Notes or documents outside this project.",
	"kit:knowledge/files": "Files of this project, also ones that git ignores.",
	"kit:knowledge/web": "Any public page, as text. No account needed.",
	"kit:knowledge/github-wiki": "The wiki of a repository, also a private one.",
	"kit:knowledge/jira": "Work items, through your signed-in Jira CLI tool.",
	"kit:knowledge/confluence":
		"Pages by id, with an API token you save as a secret.",
};

/** The input every knowledge kit has: Night Shift picks it, so the dialog does not ask. */
const FOLDER_INPUT = "folder";
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_TIME = "06:00";

/** A source to edit: its flow's name, its values and its schedule. */
export type EditedSource = {
	name: string;
	source: KnowledgeSource;
	schedule: { cron: string; enabled: boolean } | null;
};

/**
 * Adds a source to the project's knowledge, or edits one: the kind, its
 * values, whether it keeps itself up to date, and a first sync.
 */
export function SourceDialog({
	open,
	onOpenChange,
	projectId,
	edited,
	shared,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	/** Null adds a new source. */
	edited: EditedSource | null;
	/** Every Member of the Space reads the knowledge. */
	shared: boolean;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
				{open ? (
					<SourceForm
						projectId={projectId}
						edited={edited}
						shared={shared}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

/** When a source syncs on its own, as the form edits it. */
type Times =
	| { kind: "daily"; on: boolean; time: string; days: number[] }
	/** A schedule the form cannot show: it stays as it is. */
	| { kind: "own"; on: boolean };

function initialTimes(schedule: EditedSource["schedule"]): Times {
	if (!schedule) {
		return { kind: "daily", on: false, time: DEFAULT_TIME, days: EVERY_DAY };
	}
	const simple = cronToTimeAndDays(schedule.cron);
	return simple
		? { kind: "daily", on: true, ...simple }
		: { kind: "own", on: true };
}

/**
 * What the save asks of the schedule: a cron line, null to remove it, or
 * undefined to leave it. Unchanged stays undefined: changing a schedule
 * is for the owner of this computer only.
 */
function keepUpToDate(
	times: Times,
	before: EditedSource["schedule"],
): { cron: string } | null | undefined {
	if (!times.on) return before ? null : undefined;
	if (times.kind === "own") return undefined;
	const cron = timeAndDaysToCron({ time: times.time, days: times.days });
	if (cron === null || (before?.enabled && before.cron === cron)) {
		return undefined;
	}
	return { cron };
}

function SourceForm({
	projectId,
	edited,
	shared,
	onDone,
}: {
	projectId: string;
	edited: EditedSource | null;
	shared: boolean;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [kit, setKit] = useState<KnowledgeSourceKind["kit"]>(
		edited?.source.kit ?? "kit:knowledge/folder",
	);
	const [values, setValues] = useState<InputTexts>(() => ({
		...edited?.source.inputs,
	}));
	const [times, setTimes] = useState<Times>(() =>
		initialTimes(edited?.schedule ?? null),
	);
	const [syncNow, setSyncNow] = useState(true);
	const kind = KNOWLEDGE_SOURCE_KINDS.find((k) => k.kit === kit);
	const inputs = (kitFlow(kit)?.inputs ?? []).filter(
		(input) => input.name !== FOLDER_INPUT,
	);
	const missing = missingInputs(inputs, values);
	const badTime =
		times.on &&
		times.kind === "daily" &&
		!/^([01]\d|2[0-3]):[0-5]\d$/.test(times.time);
	const invalid = missing.length > 0 || badTime;

	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.flows.key() }),
			queryClient.invalidateQueries({ queryKey: orpc.schedules.key() }),
		]);
	const sync = useMutation(knowledgeMutations.sync());
	const save = useMutation(
		knowledgeMutations.saveSource({
			onSuccess: async ({ name, issues }) => {
				void refresh();
				onDone();
				const problem = issues.find((issue) => issue.severity === "error");
				if (problem) {
					toast.warning(`Saved, with a problem: ${problem.message}`);
					return;
				}
				if (!syncNow) {
					toast.success(edited ? "Source saved" : "Source added");
					return;
				}
				try {
					await sync.mutateAsync({ projectId, flowName: name });
					toast.success(
						edited
							? "Source saved. Night Shift syncs it now."
							: "Source added. Night Shift syncs it now.",
					);
					void refresh();
				} catch (error) {
					toast.error(
						`Saved, but the sync did not start: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			},
			onError: (error) => toast.error(`Could not save: ${error.message}`),
		}),
	);

	const submit = () => {
		if (invalid || save.isPending) return;
		const filled: Record<string, string> = {};
		for (const input of inputs) {
			const text = values[input.name]?.trim() ?? "";
			if (text !== "") filled[input.name] = text;
		}
		// An edited source keeps its folder in the knowledge.
		const folder = edited?.source.inputs[FOLDER_INPUT];
		if (edited?.source.kit === kit && folder !== undefined) {
			filled[FOLDER_INPUT] = folder;
		}
		const schedule = keepUpToDate(times, edited?.schedule ?? null);
		save.mutate({
			projectId,
			...(edited ? { name: edited.name } : {}),
			source: { kit, inputs: filled },
			...(schedule !== undefined
				? {
						keepUpToDate: schedule,
						timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
					}
				: {}),
		});
	};

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<DialogHeader>
				<DialogTitle>{edited ? "Edit source" : "Add source"}</DialogTitle>
				<DialogDescription>
					{edited
						? "Change what Night Shift copies into the knowledge."
						: "Choose what your agents should read. Night Shift copies it into the knowledge."}
				</DialogDescription>
			</DialogHeader>

			<FieldGroup className="gap-6">
				<FieldSet>
					<FieldLegend variant="label">Source</FieldLegend>
					<RadioGroup
						value={kit}
						onValueChange={(value) => {
							setKit(value as KnowledgeSourceKind["kit"]);
							setValues({});
						}}
						disabled={edited !== null}
						className="grid gap-2 sm:grid-cols-2"
					>
						{KNOWLEDGE_SOURCE_KINDS.map((option) => (
							<FieldLabel key={option.kit} htmlFor={`${id}-${option.kit}`}>
								<Field orientation="horizontal">
									<FieldContent>
										<FieldTitle>{option.label}</FieldTitle>
										<FieldDescription>
											{KIND_HINTS[option.kit]}
										</FieldDescription>
									</FieldContent>
									<RadioGroupItem
										value={option.kit}
										id={`${id}-${option.kit}`}
									/>
								</Field>
							</FieldLabel>
						))}
					</RadioGroup>
				</FieldSet>

				<FlowInputFields
					idPrefix={`${id}-${kit}`}
					inputs={inputs}
					values={values}
					onChange={setValues}
					lines={kind?.lines ?? []}
				/>
				{kind?.local ? (
					<FieldDescription className="-mt-3">
						Only this computer has this folder. Night Shift syncs it here.
					</FieldDescription>
				) : null}

				{shared ? (
					<Alert>
						<UsersIcon />
						<AlertTitle>Every Member of this Space can read it</AlertTitle>
						<AlertDescription>
							Make sure that each Member may see what you add here.
						</AlertDescription>
					</Alert>
				) : null}

				<FieldSeparator />

				<Field
					orientation="horizontal"
					data-invalid={badTime || undefined}
					className="items-start"
				>
					<Switch
						id={`${id}-keep`}
						checked={times.on}
						className="mt-0.5"
						onCheckedChange={(on) =>
							setTimes((current) => ({ ...current, on }))
						}
					/>
					<FieldContent>
						<FieldLabel htmlFor={`${id}-keep`}>Keep it up to date</FieldLabel>
						<FieldDescription id={`${id}-keep-hint`}>
							{!times.on
								? "Sync it only when you choose Sync now."
								: times.kind === "own"
									? "It has its own schedule. Change it on the Schedules page."
									: badTime
										? "Enter a time, for example 06:00."
										: "Night Shift syncs it at this time."}
						</FieldDescription>
					</FieldContent>
					{times.kind === "daily" ? (
						<Input
							id={`${id}-time`}
							type="time"
							value={times.time}
							disabled={!times.on}
							aria-label="Sync time"
							aria-invalid={badTime}
							aria-describedby={`${id}-keep-hint`}
							className="w-28 shrink-0 font-mono tabular-nums"
							onChange={(event) =>
								setTimes((current) => ({
									...current,
									on: true,
									time: event.target.value,
								}))
							}
						/>
					) : null}
				</Field>

				<Field orientation="horizontal" className="items-start">
					<Switch
						id={`${id}-now`}
						checked={syncNow}
						className="mt-0.5"
						onCheckedChange={setSyncNow}
					/>
					<FieldContent>
						<FieldLabel htmlFor={`${id}-now`}>Sync now</FieldLabel>
						<FieldDescription>
							Night Shift starts a sync when you save.
						</FieldDescription>
					</FieldContent>
				</Field>
			</FieldGroup>

			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button
					type="submit"
					disabled={invalid || save.isPending}
					title={
						missing.length > 0
							? `Fill in ${missing.map((input) => input.label || input.name).join(", ")} first.`
							: undefined
					}
				>
					{save.isPending ? <Spinner data-icon="inline-start" /> : null}
					{edited ? "Save changes" : "Add source"}
				</Button>
			</DialogFooter>
		</form>
	);
}
