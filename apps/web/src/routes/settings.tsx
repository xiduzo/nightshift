import type { AppRouterClient } from "@nightshift/api/routers/index";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent, CardFooter } from "@nightshift/ui/components/card";
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
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
	FieldTitle,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
	InputGroupText,
} from "@nightshift/ui/components/input-group";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@nightshift/ui/components/select";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import type { InferClientOutputs } from "@orpc/client";
import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	BellOffIcon,
	CircleAlertIcon,
	FolderGitIcon,
	LaptopIcon,
	LockIcon,
	MonitorIcon,
	MoonIcon,
	SaveIcon,
	SunIcon,
	Trash2Icon,
	TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { type ReactNode, useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { DataTable, dataTableColumns } from "@/components/data-table";
import { PageHeading, PageSection } from "@/components/page-heading";
import { SiteHeader } from "@/components/site-header";
import { notificationsSupported } from "@/hooks/use-night-notifications";
import type { PermissionMode, Project } from "@/lib/api-types";
import { HARNESSES, type HarnessName, harnessInfo } from "@/lib/harnesses";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/settings")({
	// The theme and the notification permission exist only in the browser.
	ssr: false,
	component: SettingsComponent,
});

type SettingsView = InferClientOutputs<AppRouterClient>["settings"]["get"];
type Settings = SettingsView["values"];
type SettingKey = keyof Settings;
type SettingField = SettingsView["fields"][SettingKey];
type SettingsPatch = { [K in SettingKey]?: Settings[K] | null };

/** How a draft string becomes a value, and what is wrong with it. */
type Kind =
	| { type: "int"; min: number; max: number }
	| { type: "minutes" }
	| { type: "text" }
	| { type: "choice" };

const KINDS: Partial<Record<SettingKey, Kind>> = {
	maxConcurrentRuns: { type: "int", min: 1, max: 16 },
	maxStepsPerRun: { type: "int", min: 1, max: 100_000 },
	usageLimitFirstWaitMinutes: { type: "minutes" },
	usageLimitMaxWaitMinutes: { type: "minutes" },
	networkGraceMinutes: { type: "minutes" },
	agentHarness: { type: "choice" },
	agentModel: { type: "text" },
	agentPermissionMode: { type: "choice" },
	decisionDecider: { type: "choice" },
};

const MAX_MINUTES = 10_080;

function parseDraft(
	kind: Kind,
	raw: string,
): { value: unknown } | { error: string } {
	const text = raw.trim();
	switch (kind.type) {
		case "int": {
			const n = Number(text);
			if (text === "" || !Number.isInteger(n) || n < kind.min || n > kind.max) {
				return {
					error: `A whole number from ${kind.min} to ${kind.max.toLocaleString("en-US")}.`,
				};
			}
			return { value: n };
		}
		case "minutes": {
			const n = Number(text);
			if (text === "" || !Number.isFinite(n) || n <= 0 || n > MAX_MINUTES) {
				return { error: "More than 0 and at most 10,080 minutes (a week)." };
			}
			return { value: n };
		}
		case "text":
			return text === "" ? { error: "Cannot be empty." } : { value: text };
		case "choice":
			return { value: text };
	}
}

const PERMISSION_MODES: {
	value: PermissionMode;
	label: string;
	description: string;
}[] = [
	{
		value: "auto",
		label: "Auto",
		description:
			"Claude Code approves safe actions on its own, so nobody needs to be awake. Made for nights.",
	},
	{
		value: "acceptEdits",
		label: "Accept edits",
		description:
			"The agent can edit files. It cannot run commands while nobody is there to approve them.",
	},
	{
		value: "default",
		label: "Ask for each tool",
		description:
			"Asks before each tool. At night nobody answers, so the agent cannot use its tools.",
	},
	{
		value: "plan",
		label: "Plan only",
		description: "Reads the code and writes a plan. Changes nothing.",
	},
	{
		value: "bypassPermissions",
		label: "Bypass permissions",
		description:
			"Runs every tool, shell commands included, without asking. Use it only on a repository you trust.",
	},
];

function SettingsComponent() {
	const settings = useQuery(orpc.settings.get.queryOptions());

	return (
		<>
			<SiteHeader crumbs={[{ label: "Settings" }]} />
			<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
				<div className="mx-auto w-full max-w-4xl">
					<PageHeading
						title="Settings"
						description="How Night Shift runs your flows, what a new Agent node starts with, and when this Mac tells you."
					/>
				</div>

				<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
					<ProjectsCard />
					{settings.data ? (
						<>
							<RunsCard data={settings.data} />
							<RunPolicyCard data={settings.data} />
							<AgentDefaultsCard data={settings.data} />
							<NotificationsCard data={settings.data} />
						</>
					) : settings.error ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>The settings did not load</AlertTitle>
							<AlertDescription>{settings.error.message}</AlertDescription>
							<AlertAction>
								<Button
									variant="outline"
									size="sm"
									disabled={settings.isFetching}
									onClick={() => void settings.refetch()}
								>
									{settings.isFetching ? (
										<Spinner data-icon="inline-start" />
									) : null}
									Try again
								</Button>
							</AlertAction>
						</Alert>
					) : (
						<>
							<Skeleton className="h-64 w-full rounded-xl" />
							<Skeleton className="h-56 w-full rounded-xl" />
							<Skeleton className="h-72 w-full rounded-xl" />
						</>
					)}
					<AppearanceCard />
					<ThisComputerLink name={settings.data?.daemon.device.name} />
				</div>
			</div>
		</>
	);
}

/* ----------------------------------------------------------------------------
 * Saving
 * ------------------------------------------------------------------------- */

/** Saves a patch and puts the answer in the cache, so every reader sees it. */
function useSaveSettings() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.settings.save.mutationOptions({
			onSuccess: (data) => {
				queryClient.setQueryData(orpc.settings.get.queryKey(), data);
			},
		}),
	);
}

/**
 * An on/off setting that saves at once. The switch moves before the daemon
 * answers, and moves back when the save fails.
 */
function useToggleSetting() {
	const queryClient = useQueryClient();
	const queryKey = orpc.settings.get.queryKey();
	return useMutation(
		orpc.settings.save.mutationOptions({
			onMutate: async (patch) => {
				await queryClient.cancelQueries({ queryKey });
				const before = queryClient.getQueryData<SettingsView>(queryKey);
				if (before) {
					const values = { ...before.values };
					const fields = { ...before.fields };
					for (const [key, value] of Object.entries(patch) as [
						SettingKey,
						unknown,
					][]) {
						if (value === undefined || value === null) continue;
						(values as Record<SettingKey, unknown>)[key] = value;
						fields[key] = { ...fields[key], source: "saved" };
					}
					queryClient.setQueryData(queryKey, { ...before, values, fields });
				}
				return { before };
			},
			onError: (error, _patch, context) => {
				if (context?.before) queryClient.setQueryData(queryKey, context.before);
				toast.error(`Not saved: ${error.message}`);
			},
			onSuccess: (data) => queryClient.setQueryData(queryKey, data),
		}),
	);
}

/**
 * The drafts of one card's fields. A field with no draft shows the saved
 * value. Save sends the fields that changed; Reset forgets a saved value.
 */
function useSettingsForm(data: SettingsView, keys: readonly SettingKey[]) {
	const [drafts, setDrafts] = useState<Partial<Record<SettingKey, string>>>({});
	const save = useSaveSettings();
	const reset = useSaveSettings();

	const current = (key: SettingKey) => String(data.values[key]);
	const value = (key: SettingKey) => drafts[key] ?? current(key);
	const changed = keys.filter(
		(key) => drafts[key] !== undefined && drafts[key] !== current(key),
	);
	const error = (key: SettingKey): string | undefined => {
		const kind = KINDS[key];
		if (!kind) return undefined;
		const parsed = parseDraft(kind, value(key));
		if ("error" in parsed) return parsed.error;
		// The daemon refuses this pair too; say so before the save.
		if (
			key === "usageLimitFirstWaitMinutes" &&
			Number(parsed.value) > Number(value("usageLimitMaxWaitMinutes"))
		) {
			return "Cannot be longer than the longest usage-limit wait.";
		}
		return undefined;
	};
	const invalid = keys.some((key) => error(key) !== undefined);

	return {
		value,
		error,
		dirty: changed.length > 0,
		invalid,
		saving: save.isPending,
		saveError: save.error,
		resettingKey: reset.isPending
			? (Object.keys(reset.variables ?? {})[0] as SettingKey | undefined)
			: undefined,
		set: (key: SettingKey, next: string) => {
			save.reset();
			setDrafts((before) => ({ ...before, [key]: next }));
		},
		discard: () => {
			save.reset();
			setDrafts({});
		},
		save: () => {
			const patch: Record<string, unknown> = {};
			for (const key of changed) {
				const kind = KINDS[key];
				if (!kind) continue;
				const parsed = parseDraft(kind, value(key));
				if ("value" in parsed) patch[key] = parsed.value;
			}
			save.mutate(patch as SettingsPatch, {
				onSuccess: () => {
					setDrafts({});
					toast.success("Settings saved");
				},
			});
		},
		reset: (key: SettingKey, label: string) => {
			reset.mutate({ [key]: null } as SettingsPatch, {
				onSuccess: (next) => {
					setDrafts((before) => {
						const { [key]: _dropped, ...rest } = before;
						return rest;
					});
					toast.success(`${label} reset to ${String(next.values[key])}`);
				},
				onError: (resetError) => toast.error(resetError.message),
			});
		},
	};
}

type SettingsForm = ReturnType<typeof useSettingsForm>;

/** Discard and Save at the bottom of a card with a form. */
function FormFooter({ form, label }: { form: SettingsForm; label: string }) {
	return (
		<CardFooter className="justify-end gap-2 border-t">
			{form.dirty && !form.saving ? (
				<Button type="button" variant="ghost" onClick={form.discard}>
					Discard
				</Button>
			) : null}
			<Button
				type="submit"
				disabled={!form.dirty || form.invalid || form.saving}
			>
				{form.saving ? (
					<Spinner data-icon="inline-start" />
				) : (
					<SaveIcon data-icon="inline-start" />
				)}
				{form.saving ? "Saving…" : label}
			</Button>
		</CardFooter>
	);
}

/** The daemon's answer when it refused a save. */
function SaveError({ error }: { error: Error | null }) {
	if (!error) return null;
	return (
		<Alert variant="destructive">
			<CircleAlertIcon />
			<AlertTitle>Not saved</AlertTitle>
			<AlertDescription>{error.message}</AlertDescription>
		</Alert>
	);
}

/* ----------------------------------------------------------------------------
 * Fields
 * ------------------------------------------------------------------------- */

/** Where a value comes from: its default, the daemon's environment, or a saved value. */
function SettingSource({
	field,
	label,
	format = String,
	resetting,
	onReset,
}: {
	field: SettingField;
	label: string;
	format?: (value: unknown) => string;
	resetting: boolean;
	onReset: () => void;
}) {
	const fallback =
		field.envValue !== undefined
			? `${format(field.envValue)}, set outside Night Shift`
			: `${format(field.default)}, the default`;
	return (
		<div className="flex min-h-6 flex-wrap items-center gap-2">
			{field.source === "saved" ? (
				<>
					<Badge variant="secondary">Saved</Badge>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						disabled={resetting}
						title={`Back to ${fallback}`}
						aria-label={`Reset ${label}, back to ${fallback}`}
						onClick={onReset}
					>
						{resetting ? <Spinner data-icon="inline-start" /> : null}
						Reset
					</Button>
				</>
			) : field.source === "env" ? (
				<Badge variant="outline" className="font-mono">
					Set outside Night Shift
				</Badge>
			) : (
				<Badge variant="outline" className="text-muted-foreground">
					Default
				</Badge>
			)}
		</div>
	);
}

/** A number or text setting: label, input, description, error, source. */
function TextSetting({
	form,
	data,
	settingKey,
	label,
	description,
	unit,
	inputMode,
	mono,
	suggestions,
}: {
	form: SettingsForm;
	data: SettingsView;
	settingKey: SettingKey;
	label: string;
	description: ReactNode;
	unit?: string;
	inputMode?: "numeric" | "decimal";
	mono?: boolean;
	suggestions?: readonly string[];
}) {
	const id = useId();
	const error = form.error(settingKey);
	const describedBy = `${id}-description${error ? ` ${id}-error` : ""}`;
	const inputProps = {
		id,
		value: form.value(settingKey),
		onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
			form.set(settingKey, event.target.value),
		inputMode,
		autoComplete: "off",
		spellCheck: false,
		list: suggestions ? `${id}-suggestions` : undefined,
		"aria-invalid": error ? true : undefined,
		"aria-describedby": describedBy,
		className: mono ? "font-mono" : "tabular-nums",
	} as const;

	return (
		<Field data-invalid={error ? true : undefined}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			{unit ? (
				<InputGroup>
					<InputGroupInput {...inputProps} />
					<InputGroupAddon align="inline-end">
						<InputGroupText>{unit}</InputGroupText>
					</InputGroupAddon>
				</InputGroup>
			) : (
				<Input {...inputProps} />
			)}
			{suggestions ? (
				<datalist id={`${id}-suggestions`}>
					{suggestions.map((value) => (
						<option key={value} value={value} />
					))}
				</datalist>
			) : null}
			{error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
			<FieldDescription id={`${id}-description`}>
				{description}
			</FieldDescription>
			<SettingSource
				field={data.fields[settingKey]}
				label={label}
				resetting={form.resettingKey === settingKey}
				onReset={() => form.reset(settingKey, label)}
			/>
		</Field>
	);
}

/** A choice from a short list, in a Select. */
function SelectSetting<V extends string>({
	form,
	data,
	settingKey,
	label,
	description,
	options,
	onPick,
}: {
	form: SettingsForm;
	data: SettingsView;
	settingKey: SettingKey;
	label: string;
	description: ReactNode;
	options: readonly { value: V; label: string }[];
	onPick?: (value: V) => void;
}) {
	const id = useId();
	const labelOf = (value: unknown) =>
		options.find((option) => option.value === value)?.label ?? String(value);
	return (
		<Field>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select
				items={options}
				value={form.value(settingKey) as V}
				onValueChange={(value) => {
					if (value === null) return;
					form.set(settingKey, value);
					onPick?.(value);
				}}
			>
				<SelectTrigger
					id={id}
					className="w-full"
					aria-describedby={`${id}-description`}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectGroup>
						{options.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectGroup>
				</SelectContent>
			</Select>
			<FieldDescription id={`${id}-description`}>
				{description}
			</FieldDescription>
			<SettingSource
				field={data.fields[settingKey]}
				label={label}
				format={labelOf}
				resetting={form.resettingKey === settingKey}
				onReset={() => form.reset(settingKey, label)}
			/>
		</Field>
	);
}

/** A form inside a card: Enter saves. */
function CardForm({
	form,
	children,
}: {
	form: SettingsForm;
	children: ReactNode;
}) {
	return (
		<form
			className="contents"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				if (form.dirty && !form.invalid && !form.saving) form.save();
			}}
		>
			{children}
		</form>
	);
}

/* ----------------------------------------------------------------------------
 * Projects
 * ------------------------------------------------------------------------- */

function ProjectsCard() {
	const queryClient = useQueryClient();
	const projects = useQuery(orpc.projects.list.queryOptions());
	const flows = useQueries({
		queries: (projects.data ?? []).map((project) => ({
			...orpc.flows.list.queryOptions({ input: { projectId: project.id } }),
			staleTime: 30_000,
			meta: { quietErrors: true },
		})),
	});
	const [toRemove, setToRemove] = useState<Project | null>(null);
	const removeProject = useMutation(
		orpc.projects.remove.mutationOptions({
			onSuccess: () => {
				setToRemove(null);
				void queryClient.invalidateQueries({ queryKey: orpc.projects.key() });
				void queryClient.invalidateQueries({ queryKey: orpc.runs.key() });
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	return (
		<PageSection
			title="Projects"
			description="The git repositories Night Shift works in. Each run works on its own copy, so your checkout stays as it is."
		>
			<Card className="py-0">
				<CardContent className="px-0">
					{projects.isLoading ? (
						<div className="flex flex-col gap-3 p-6">
							<Skeleton className="h-6 w-full" />
							<Skeleton className="h-6 w-2/3" />
						</div>
					) : !projects.data || projects.data.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<FolderGitIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>No projects yet</EmptyTitle>
								<EmptyDescription>
									Add a git repository with + next to Projects in the sidebar.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<DataTable
							columns={projectColumns({
								flowCounts: flows.map((flow) => flow.data?.length),
								removing: removeProject.isPending,
								onRemove: setToRemove,
							})}
							data={projects.data}
							getRowId={(project) => project.id}
						/>
					)}
				</CardContent>
				<AlertDialog
					open={toRemove !== null}
					onOpenChange={(open) => {
						if (!open) setToRemove(null);
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								Remove {toRemove?.name} from Night Shift?
							</AlertDialogTitle>
							<AlertDialogDescription>
								Night Shift forgets the project and its runs. The repository at{" "}
								<span className="font-mono">{toRemove?.repoPath}</span> stays as
								it is.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								disabled={removeProject.isPending}
								onClick={() => {
									if (toRemove)
										removeProject.mutate({ projectId: toRemove.id });
								}}
							>
								{removeProject.isPending ? (
									<Spinner data-icon="inline-start" />
								) : null}
								{removeProject.isPending ? "Removing…" : "Remove project"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</Card>
		</PageSection>
	);
}

/* ----------------------------------------------------------------------------
 * Runs and run policy
 * ------------------------------------------------------------------------- */

const RUN_KEYS = ["maxConcurrentRuns", "maxStepsPerRun"] as const;

const projectColumn = dataTableColumns<Project>();

function projectColumns({
	flowCounts,
	removing,
	onRemove,
}: {
	/** The number of flows of each project, in list order; undefined while it loads. */
	flowCounts: (number | undefined)[];
	removing: boolean;
	onRemove: (project: Project) => void;
}) {
	return projectColumn.columns([
		projectColumn.accessor("name", {
			header: "Project",
			cell: ({ row: { original: project, index } }) => {
				const count = flowCounts[index];
				return (
					<div className="flex min-w-0 flex-col gap-0.5">
						<Link
							to="/projects/$projectId"
							params={{ projectId: project.id }}
							className="truncate font-medium underline-offset-4 hover:underline"
						>
							{project.name}
						</Link>
						<span className="text-muted-foreground text-xs tabular-nums">
							{count === undefined
								? "Flows…"
								: `${count} ${count === 1 ? "flow" : "flows"}`}
						</span>
						<span
							className="truncate font-mono text-muted-foreground text-xs md:hidden"
							title={project.repoPath}
						>
							{project.repoPath}
						</span>
					</div>
				);
			},
			meta: {
				headClassName: "pl-6",
				cellClassName: "max-w-0 pl-6 md:max-w-none",
			},
		}),
		projectColumn.accessor("repoPath", {
			header: "Folder",
			cell: ({ row }) => (
				<span
					className="block truncate font-mono text-muted-foreground text-xs"
					title={row.original.repoPath}
				>
					{row.original.repoPath}
				</span>
			),
			meta: {
				headClassName: "hidden md:table-cell",
				cellClassName: "hidden max-w-80 md:table-cell",
			},
		}),
		projectColumn.display({
			id: "actions",
			header: () => <span className="sr-only">Actions</span>,
			cell: ({ row: { original: project } }) => (
				<Button
					variant="ghost"
					size="sm"
					className="text-muted-foreground hover:text-destructive"
					disabled={removing}
					aria-label={`Remove ${project.name}`}
					onClick={() => onRemove(project)}
				>
					<Trash2Icon data-icon="inline-start" />
					<span className="hidden sm:inline">Remove</span>
				</Button>
			),
			meta: {
				headClassName: "pr-6 text-right",
				cellClassName: "w-0 pr-6 text-right",
			},
		}),
	]);
}

function RunsCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, RUN_KEYS);
	const toggle = useToggleSetting();
	const scheduler = data.fields.scheduler;
	const id = useId();

	return (
		<PageSection
			title="Runs"
			description="When runs start and how far one run may go."
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<Field
								orientation="horizontal"
								data-disabled={scheduler.locked ? true : undefined}
							>
								<FieldContent>
									<FieldLabel htmlFor={`${id}-scheduler`}>Schedules</FieldLabel>
									<FieldDescription>
										Night Shift starts flows at the times you schedule. Turn it
										off to run flows only when you start them.
									</FieldDescription>
								</FieldContent>
								<Switch
									id={`${id}-scheduler`}
									checked={data.values.scheduler}
									disabled={Boolean(scheduler.locked) || toggle.isPending}
									aria-describedby={
										scheduler.locked ? `${id}-scheduler-lock` : undefined
									}
									onCheckedChange={(checked) =>
										toggle.mutate({ scheduler: checked })
									}
								/>
							</Field>
							{scheduler.locked ? (
								<Alert id={`${id}-scheduler-lock`}>
									<LockIcon />
									<AlertTitle className="flex flex-wrap items-center gap-2">
										Schedules are paused on this computer
										<Badge
											variant="outline"
											className="border-status-waiting/40 bg-status-waiting/10 font-mono text-status-waiting"
										>
											NIGHTSHIFT_SCHEDULER=off
										</Badge>
									</AlertTitle>
									<AlertDescription>{scheduler.locked}</AlertDescription>
								</Alert>
							) : null}
							<FieldSeparator />
							<div className="grid gap-6 sm:grid-cols-2">
								<TextSetting
									form={form}
									data={data}
									settingKey="maxConcurrentRuns"
									label="Max concurrent runs"
									description="How many runs can work at the same time. Extra runs wait their turn."
									inputMode="numeric"
								/>
								<TextSetting
									form={form}
									data={data}
									settingKey="maxStepsPerRun"
									label="Max steps per run"
									description="A safety net for a flow that loops: the run stops after this many steps. You can resume it."
									inputMode="numeric"
								/>
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
					<FormFooter form={form} label="Save runs" />
				</CardForm>
			</Card>
		</PageSection>
	);
}

const POLICY_KEYS = [
	"usageLimitFirstWaitMinutes",
	"usageLimitMaxWaitMinutes",
	"networkGraceMinutes",
] as const;

function RunPolicyCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, POLICY_KEYS);
	return (
		<PageSection
			title="Run policy"
			description="Defaults for flows that do not set their own."
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<ResumeSetting data={data} />
							<FieldSeparator />
							<div className="grid gap-6 sm:grid-cols-2">
								<TextSetting
									form={form}
									data={data}
									settingKey="usageLimitFirstWaitMinutes"
									label="First usage-limit wait"
									description="An agent hits its usage limit and gives no reset time. The run waits this long, then tries again."
									unit="min"
									inputMode="decimal"
								/>
								<TextSetting
									form={form}
									data={data}
									settingKey="usageLimitMaxWaitMinutes"
									label="Longest usage-limit wait"
									description="Each next wait is twice as long, up to this."
									unit="min"
									inputMode="decimal"
								/>
								<TextSetting
									form={form}
									data={data}
									settingKey="networkGraceMinutes"
									label="Network grace"
									description="The longest total wait for the network to come back. Then the step fails."
									unit="min"
									inputMode="decimal"
								/>
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
					<FormFooter form={form} label="Save run policy" />
				</CardForm>
			</Card>
		</PageSection>
	);
}

/** Whether a run the daemon stopped mid-step continues on its own. Saves at once. */
function ResumeSetting({ data }: { data: SettingsView }) {
	const id = useId();
	const toggle = useToggleSetting();
	const label = "Resume after a restart";
	return (
		<Field orientation="horizontal">
			<FieldContent>
				<FieldLabel htmlFor={`${id}-resume`}>{label}</FieldLabel>
				<FieldDescription>
					When Night Shift stops in the middle of a run, the run continues on
					its own after Night Shift starts again. This works only with schedules
					on, before the run's stop time, and up to 3 times in a row. Turn it
					off to resume runs yourself.
				</FieldDescription>
				<SettingSource
					field={data.fields.resumeInterruptedRuns}
					label={label}
					format={(value) => (value ? "on" : "off")}
					resetting={
						toggle.isPending && toggle.variables?.resumeInterruptedRuns === null
					}
					onReset={() => toggle.mutate({ resumeInterruptedRuns: null })}
				/>
			</FieldContent>
			<Switch
				id={`${id}-resume`}
				checked={data.values.resumeInterruptedRuns}
				disabled={toggle.isPending}
				onCheckedChange={(checked) =>
					toggle.mutate({ resumeInterruptedRuns: checked })
				}
			/>
		</Field>
	);
}

/* ----------------------------------------------------------------------------
 * New Agent nodes
 * ------------------------------------------------------------------------- */

const AGENT_KEYS = [
	"agentHarness",
	"agentModel",
	"agentPermissionMode",
	"decisionDecider",
] as const;

function AgentDefaultsCard({ data }: { data: SettingsView }) {
	const form = useSettingsForm(data, AGENT_KEYS);
	const harness = harnessInfo(form.value("agentHarness") as HarnessName);
	const mode = PERMISSION_MODES.find(
		(option) => option.value === form.value("agentPermissionMode"),
	);
	const deciders = useQuery(orpc.deciders.list.queryOptions());
	const deciderOptions = (deciders.data ?? []).map((d) => ({
		value: d.name,
		label: d.label,
	}));

	return (
		<PageSection
			title="New Agent nodes"
			description="What a new Agent or Decision node starts with in the flow editor. Nodes you already made keep their own values."
		>
			<Card>
				<CardForm form={form}>
					<CardContent>
						<FieldGroup>
							<div className="grid gap-6 sm:grid-cols-2">
								<SelectSetting
									form={form}
									data={data}
									settingKey="agentHarness"
									label="Harness"
									description={harness.note}
									options={HARNESSES}
									onPick={(next) => {
										// A model suggested for the old harness means nothing to the new one.
										const model = form.value("agentModel");
										if (harness.models.includes(model) || model.trim() === "") {
											form.set("agentModel", harnessInfo(next).defaultModel);
										}
									}}
								/>
								<TextSetting
									form={form}
									data={data}
									settingKey="agentModel"
									label="Model"
									description={`Any model ${harness.label} supports, for example ${harness.models.slice(0, 3).join(", ")}.`}
									mono
									suggestions={harness.models}
								/>
								<SelectSetting
									form={form}
									data={data}
									settingKey="agentPermissionMode"
									label="Permission mode"
									description={
										mode?.value === "bypassPermissions" ? (
											<span className="flex items-start gap-1.5 text-status-waiting">
												<TriangleAlertIcon
													className="mt-0.5 size-3.5 shrink-0"
													aria-hidden="true"
												/>
												{mode.description}
											</span>
										) : (
											mode?.description
										)
									}
									options={PERMISSION_MODES}
								/>
								<SelectSetting
									form={form}
									data={data}
									settingKey="decisionDecider"
									label="Decider"
									description="A new Decision node picks its label with this decision model."
									options={deciderOptions}
								/>
							</div>
							<SaveError error={form.saveError} />
						</FieldGroup>
					</CardContent>
					<FormFooter form={form} label="Save defaults" />
				</CardForm>
			</Card>
		</PageSection>
	);
}

/* ----------------------------------------------------------------------------
 * Notifications
 * ------------------------------------------------------------------------- */

type Permission = NotificationPermission | "unsupported";

const NOTIFICATIONS: {
	key: "notifyGateOpened" | "notifyRunFinished" | "notifyRunFailed";
	label: string;
	description: string;
}[] = [
	{
		key: "notifyGateOpened",
		label: "A Gate opens",
		description: "A run waits for your answer.",
	},
	{
		key: "notifyRunFinished",
		label: "A run finishes",
		description: "With the outcome it ended on.",
	},
	{
		key: "notifyRunFailed",
		label: "A run fails",
		description: "With the reason it failed.",
	},
];

function NotificationsCard({ data }: { data: SettingsView }) {
	const id = useId();
	const toggle = useToggleSetting();
	const [permission, setPermission] = useState<Permission | null>(null);

	useEffect(() => {
		setPermission(
			notificationsSupported() ? Notification.permission : "unsupported",
		);
	}, []);

	async function ask() {
		if (!notificationsSupported()) return;
		setPermission(await Notification.requestPermission());
	}

	const anyOn = NOTIFICATIONS.some(({ key }) => data.values[key]);

	return (
		<PageSection
			title="Notifications on this Mac"
			description="This browser shows them while Night Shift is open in a tab. Each switch saves at once."
		>
			<Card>
				<CardContent>
					<FieldGroup>
						{permission === "denied" && anyOn ? (
							<Alert>
								<BellOffIcon />
								<AlertTitle>This browser blocks notifications</AlertTitle>
								<AlertDescription>
									Allow notifications for this site in the browser's site
									settings (the icon left of the address). On macOS, also allow
									the browser in System Settings, Notifications.
								</AlertDescription>
							</Alert>
						) : permission === "unsupported" ? (
							<Alert>
								<BellOffIcon />
								<AlertTitle>No notifications in this browser</AlertTitle>
								<AlertDescription>
									This browser cannot show desktop notifications.
								</AlertDescription>
							</Alert>
						) : permission === "default" && anyOn ? (
							<Alert>
								<CircleAlertIcon />
								<AlertTitle>The browser has not allowed them yet</AlertTitle>
								<AlertDescription>
									Nothing shows until you allow notifications for this site.
								</AlertDescription>
								<AlertAction>
									<Button
										size="sm"
										variant="outline"
										onClick={() => void ask()}
									>
										Allow
									</Button>
								</AlertAction>
							</Alert>
						) : null}
						{NOTIFICATIONS.map(({ key, label, description }, index) => (
							<div key={key} className="contents">
								{index > 0 ? <FieldSeparator /> : null}
								<Field orientation="horizontal">
									<FieldContent>
										<FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
										<FieldDescription>{description}</FieldDescription>
									</FieldContent>
									<Switch
										id={`${id}-${key}`}
										checked={data.values[key]}
										disabled={permission === "unsupported"}
										onCheckedChange={(checked) => {
											if (checked && permission === "default") void ask();
											toggle.mutate({ [key]: checked });
										}}
									/>
								</Field>
							</div>
						))}
					</FieldGroup>
				</CardContent>
			</Card>
		</PageSection>
	);
}

/* ----------------------------------------------------------------------------
 * Appearance
 * ------------------------------------------------------------------------- */

const THEMES = [
	{
		value: "system",
		label: "Match the system",
		description: "Light or dark, as macOS is.",
		icon: MonitorIcon,
	},
	{
		value: "dark",
		label: "Dark",
		description: "For the night.",
		icon: MoonIcon,
	},
	{
		value: "light",
		label: "Light",
		description: "For the morning after.",
		icon: SunIcon,
	},
] as const;

function AppearanceCard() {
	const id = useId();
	const { theme, setTheme } = useTheme();
	// next-themes knows the theme only after it mounts in the browser.
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	return (
		<PageSection title="Appearance" description="Saved in this browser only.">
			<Card>
				<CardContent>
					<RadioGroup
						aria-label="Theme"
						value={mounted ? (theme ?? "system") : null}
						onValueChange={(value) => setTheme(String(value))}
						className="grid gap-3 sm:grid-cols-3"
					>
						{THEMES.map(({ value, label, description, icon: Icon }) => (
							<FieldLabel key={value} htmlFor={`${id}-${value}`}>
								<Field orientation="horizontal">
									<FieldContent>
										<FieldTitle>
											<Icon className="size-4" aria-hidden="true" />
											{label}
										</FieldTitle>
										<FieldDescription>{description}</FieldDescription>
									</FieldContent>
									<RadioGroupItem value={value} id={`${id}-${value}`} />
								</Field>
							</FieldLabel>
						))}
					</RadioGroup>
				</CardContent>
			</Card>
		</PageSection>
	);
}

/* ----------------------------------------------------------------------------
 * This computer: on the Devices page
 * ------------------------------------------------------------------------- */

function ThisComputerLink({ name }: { name: string | undefined }) {
	return (
		<PageSection
			title="This computer"
			description="Its name, where it keeps its data, and the computers it works with."
		>
			<Card>
				<CardContent>
					<Item size="sm" className="px-0">
						<ItemMedia variant="icon">
							<LaptopIcon aria-hidden="true" />
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle>{name ?? <Skeleton className="h-4 w-32" />}</ItemTitle>
							<ItemDescription className="line-clamp-none">
								Be a Host, pair your other computers, and see where your data
								is, on the Devices page.
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Button
								variant="outline"
								size="sm"
								nativeButton={false}
								render={<Link to="/devices" />}
							>
								Devices
							</Button>
						</ItemActions>
					</Item>
				</CardContent>
			</Card>
		</PageSection>
	);
}
