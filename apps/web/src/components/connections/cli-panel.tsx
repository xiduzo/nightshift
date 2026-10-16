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
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CircleAlertIcon,
	FolderPenIcon,
	RefreshCwIcon,
	RotateCcwIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { formatDateTime, formatTime } from "@/lib/format";
import { orpc } from "@/utils/orpc";

import { CheckBadge, type CheckState, FactList, OffMachineNote } from "./parts";
import type { CheckTarget, CliCheck, SettingsView } from "./types";

type BinKey = "claudeBin" | "opencodeBin" | "codexBin";

export type Tool = {
	target: CheckTarget;
	title: string;
	initials: string;
	/** What Night Shift uses it for. */
	role: string;
	setting: BinKey;
	offMachine: (check: CliCheck | undefined) => string;
};

/** The CLIs Night Shift runs on this machine. */
export const TOOLS: Tool[] = [
	{
		target: "claude-code",
		title: "Claude Code",
		initials: "CC",
		role: "Harness for Agent nodes",
		setting: "claudeBin",
		offMachine: () =>
			"Prompts and your project's code go to Anthropic under your Claude login.",
	},
	{
		target: "opencode",
		title: "OpenCode",
		initials: "OC",
		role: "Harness for Agent nodes",
		setting: "opencodeBin",
		offMachine: () =>
			"Prompts and code go to the model provider OpenCode is set up with.",
	},
	{
		target: "codex",
		title: "Codex",
		initials: "CX",
		role: "Harness for Agent nodes",
		setting: "codexBin",
		offMachine: () => "Prompts and code go to OpenAI under your Codex login.",
	},
];

export function checkState(check: CliCheck | undefined): CheckState {
	if (!check) return "checking";
	if (!check.path) return "missing";
	return check.problem ? "problem" : "ready";
}

/** Where the executable setting gets its value. */
function sourceText(settings: SettingsView, key: BinKey): string {
	const field = settings.fields[key];
	if (field.source === "saved") return "You set this path";
	if (field.source === "env") return "Set outside Night Shift";
	return "Found automatically";
}

/** The fallback once the saved value is gone. */
function fallbackText(settings: SettingsView, key: BinKey): string {
	const field = settings.fields[key];
	return field.source === "saved"
		? "Choose Use the default to let Night Shift find it again."
		: "Change it only if Night Shift uses the wrong copy.";
}

/**
 * One CLI on this machine: where it is, its version and login, why it cannot
 * run (if so), and where its prompts go. Check again and change its path.
 */
export function CliPanel({
	tool,
	settings,
}: {
	tool: Tool;
	settings: SettingsView | undefined;
}) {
	const [changing, setChanging] = useState(false);
	const check = useCliCheck(tool.target);
	const data = check.data;

	return (
		<div className="flex flex-col gap-4">
			{check.isPending ? (
				<div className="flex flex-col gap-2.5" aria-hidden>
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-4 w-1/2" />
					<Skeleton className="h-4 w-2/3" />
				</div>
			) : check.error && !data ? (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertTitle>The check did not run</AlertTitle>
					<AlertDescription>{check.error.message}</AlertDescription>
				</Alert>
			) : data ? (
				<>
					<FactList
						facts={[
							{
								label: "Path",
								value: (
									<span className="font-mono text-xs leading-5">
										{data.path ?? (
											<span className="text-muted-foreground">
												{data.bin} not found
											</span>
										)}
									</span>
								),
							},
							...(data.version
								? [
										{
											label: "Version",
											value: (
												<span className="font-mono text-xs leading-5">
													{data.version}
												</span>
											),
										},
									]
								: []),
							...(data.account
								? [{ label: "Account", value: data.account }]
								: []),
							...data.facts.map((fact) => ({
								label: fact.label,
								value: fact.value,
							})),
						]}
					/>
					{data.problem ? (
						<Alert
							variant={data.path ? "destructive" : "default"}
							className={
								data.path
									? undefined
									: "border-status-waiting/40 text-status-waiting"
							}
						>
							<CircleAlertIcon />
							<AlertDescription
								className={data.path ? undefined : "text-foreground/80"}
							>
								{data.problem}
							</AlertDescription>
						</Alert>
					) : null}
				</>
			) : null}
			<OffMachineNote>{tool.offMachine(data)}</OffMachineNote>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={check.isFetching}
					onClick={() => void check.refetch()}
				>
					{check.isFetching ? (
						<Spinner data-icon="inline-start" />
					) : (
						<RefreshCwIcon data-icon="inline-start" />
					)}
					{check.isFetching ? "Checking…" : "Check again"}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={!settings}
					onClick={() => setChanging(true)}
				>
					<FolderPenIcon data-icon="inline-start" />
					Change path
				</Button>
				{data ? (
					<span
						className="ml-auto text-muted-foreground text-xs"
						title={formatDateTime(data.checkedAt)}
					>
						Checked {formatTime(data.checkedAt)}
					</span>
				) : null}
			</div>
			{settings ? (
				<ChangePathDialog
					open={changing}
					onOpenChange={setChanging}
					tool={tool}
					settings={settings}
				/>
			) : null}
		</div>
	);
}

/** The read-only check of one CLI, shared by the list badges and the detail. */
export function useCliCheck(target: CheckTarget) {
	return useQuery({
		...orpc.connections.check.queryOptions({ input: { target } }),
		staleTime: 60_000,
		meta: { quietErrors: true },
	});
}

/** The badge of a check: ready, problem, not found, or checking. */
export function CliCheckBadge({ target }: { target: CheckTarget }) {
	const check = useCliCheck(target);
	if (check.error && !check.data) return <CheckBadge state="problem" />;
	return (
		<CheckBadge state={check.isPending ? "checking" : checkState(check.data)} />
	);
}

export function toolFor(target: CheckTarget): Tool {
	return TOOLS.find((t) => t.target === target) as Tool;
}

/** Sets the executable Night Shift runs for one CLI, or goes back to the default. */
function ChangePathDialog({
	open,
	onOpenChange,
	tool,
	settings,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tool: Tool;
	settings: SettingsView;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				{open ? (
					<ChangePathForm
						tool={tool}
						settings={settings}
						onDone={() => onOpenChange(false)}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function ChangePathForm({
	tool,
	settings,
	onDone,
}: {
	tool: Tool;
	settings: SettingsView;
	onDone: () => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const key = tool.setting;
	const current = settings.values[key];
	const [value, setValue] = useState(current);
	const saved = settings.fields[key].source === "saved";

	const save = useMutation(
		orpc.settings.save.mutationOptions({
			onSuccess: (next, patch) => {
				queryClient.setQueryData(orpc.settings.get.queryKey(), next);
				void queryClient.invalidateQueries({
					queryKey: orpc.settings.key(),
				});
				void queryClient.invalidateQueries({
					queryKey: orpc.connections.check.queryKey({
						input: { target: tool.target },
					}),
				});
				toast.success(
					patch[key] === null
						? `${tool.title} uses the default again`
						: `Saved the path for ${tool.title}`,
				);
				onDone();
			},
		}),
	);
	const trimmed = value.trim();

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!trimmed) return;
				save.mutate({ [key]: trimmed });
			}}
		>
			<DialogHeader>
				<DialogTitle>Change the {tool.title} path</DialogTitle>
				<DialogDescription>
					Where {tool.title} is installed on this computer. Enter its full path
					or its command name.
				</DialogDescription>
			</DialogHeader>
			<FieldGroup className="gap-5">
				<Field>
					<FieldLabel htmlFor={`${id}-bin`}>Path</FieldLabel>
					<Input
						id={`${id}-bin`}
						value={value}
						onChange={(event) => setValue(event.target.value)}
						placeholder={String(settings.fields[key].default)}
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						autoFocus
						required
						aria-describedby={`${id}-bin-hint`}
					/>
					<FieldDescription id={`${id}-bin-hint`}>
						Now: <span className="font-mono">{current}</span> ·{" "}
						{sourceText(settings, key)}. {fallbackText(settings, key)}
					</FieldDescription>
				</Field>
				{save.error ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertDescription>{save.error.message}</AlertDescription>
					</Alert>
				) : null}
			</FieldGroup>
			<DialogFooter className="gap-2 sm:justify-between">
				{saved ? (
					<Button
						type="button"
						variant="ghost"
						disabled={save.isPending}
						onClick={() => save.mutate({ [key]: null })}
					>
						<RotateCcwIcon data-icon="inline-start" />
						Use the default
					</Button>
				) : (
					<span className="hidden sm:block" />
				)}
				<div className="flex flex-col-reverse gap-2 sm:flex-row">
					<DialogClose render={<Button variant="outline" type="button" />}>
						Cancel
					</DialogClose>
					<Button
						type="submit"
						disabled={!trimmed || trimmed === current || save.isPending}
					>
						{save.isPending ? <Spinner data-icon="inline-start" /> : null}
						{save.isPending ? "Saving…" : "Save"}
					</Button>
				</div>
			</DialogFooter>
		</form>
	);
}
