import {
	Alert,
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
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CircleAlertIcon,
	RefreshCwIcon,
	SquareTerminalIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { CliTool } from "@/shared/api";
import { orpc } from "@/shared/api";
import { CodeView } from "@/shared/code";
import { checkState } from "./connections/cli-panel";
import { CheckBadge, FactList } from "./connections/parts";

import { DetailSection, DetailShell } from "./detail-shell";
import { UsedBySection } from "./tool-detail";

/** The program name only: what a shell types to run it. */
const PROGRAM = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

/** At most this many programs show in the list; typing narrows it. */
const SHOWN = 50;

/** Where the program is and its version, asked once and kept a while. */
export function useCliToolCheck(name: string) {
	return useQuery({
		...orpc.cliTools.check.queryOptions({ input: { name } }),
		staleTime: 60_000,
		meta: { quietErrors: true },
	});
}

/** The badge of a CLI tool: ready, not found, or checking. */
export function CliToolCheckBadge({ name }: { name: string }) {
	const check = useCliToolCheck(name);
	if (check.error && !check.data) return <CheckBadge state="problem" />;
	return (
		<CheckBadge state={check.isPending ? "checking" : checkState(check.data)} />
	);
}

/** A CLI tool: a program on this computer that the agents may run. */
export function CliToolDetail({
	tool,
	onEdit,
	onOpenProfile,
	onRemoved,
}: {
	tool: CliTool;
	onEdit: () => void;
	onOpenProfile: (name: string) => void;
	onRemoved: () => void;
}) {
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState(false);
	const check = useCliToolCheck(tool.name);
	const data = check.data;
	const remove = useMutation(
		orpc.cliTools.remove.mutationOptions({
			onSuccess: () => {
				toast.success(`Removed ${tool.name}`);
				void queryClient.invalidateQueries({
					queryKey: orpc.cliTools.list.key(),
				});
				void queryClient.invalidateQueries({ queryKey: orpc.profiles.key() });
				onRemoved();
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);

	return (
		<DetailShell
			icon={<SquareTerminalIcon />}
			kicker="Tool · CLI"
			title={tool.name}
			mono
			subtitle={tool.description ?? undefined}
			actions={[
				{ label: "Edit", onSelect: onEdit },
				{
					label: "Remove",
					destructive: true,
					onSelect: () => setRemoving(true),
				},
			]}
		>
			<DetailSection
				title="On this computer"
				description={
					<>
						Agents with this tool run{" "}
						<span className="font-mono">{tool.name}</span> with any arguments,
						without asking. Only Claude Code and OpenCode keep a list of allowed
						programs. On other harnesses, the permission mode decides.
					</>
				}
			>
				<div className="flex flex-col gap-4">
					{check.isPending ? (
						<div className="flex flex-col gap-2.5" aria-hidden>
							<Skeleton className="h-4 w-3/4" />
							<Skeleton className="h-4 w-1/2" />
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
											<span className="break-all font-mono text-xs leading-5">
												{data.path ?? "Not found"}
											</span>
										),
									},
									{
										label: "Version",
										value: data.version ?? (
											<span className="text-muted-foreground">Unknown</span>
										),
									},
									...(data.account
										? [{ label: "Account", value: data.account }]
										: []),
									...data.facts,
								]}
							/>
							{data.problem ? (
								<Alert variant="destructive">
									<CircleAlertIcon />
									<AlertTitle>Flows with this tool do not start</AlertTitle>
									<AlertDescription>{data.problem}</AlertDescription>
								</Alert>
							) : null}
						</>
					) : null}
					<div>
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
							Check again
						</Button>
					</div>
				</div>
			</DetailSection>

			{data?.path ? (
				<DetailSection
					title="Help for agents"
					description="Agents with this tool read this help and its description when a step starts. Write a description that says when to use it."
				>
					{data.help ? (
						<CodeView
							code={data.help}
							language="text"
							title={<span className="font-mono">{`${tool.name} --help`}</span>}
							contentClassName="max-h-96"
						/>
					) : (
						<p className="text-muted-foreground text-sm">
							<span className="font-mono">{tool.name}</span> shows no help.
							Agents get its name and description only.
						</p>
					)}
				</DetailSection>
			) : null}

			<UsedBySection
				profiles={tool.profiles}
				flows={tool.usedBy}
				onOpenProfile={onOpenProfile}
			/>

			<AlertDialog open={removing} onOpenChange={setRemoving}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove {tool.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							{[
								tool.profiles.length > 0
									? `It comes off the profiles ${tool.profiles.join(", ")}.`
									: null,
								tool.usedBy.length > 0
									? `Flows that name it (${tool.usedBy.map((u) => u.flowName).join(", ")}) do not start until you take it off.`
									: null,
							]
								.filter(Boolean)
								.join(" ") || "Nothing uses it."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => remove.mutate({ name: tool.name })}
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DetailShell>
	);
}

/** Add a CLI tool (pick a program), or change the description of one. */
export function CliToolDialog({
	open,
	onOpenChange,
	tool,
	taken,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The tool to edit; null to add one. */
	tool: CliTool | null;
	/** The CLI tools that exist, which the list leaves out. */
	taken: string[];
	onSaved: (name: string) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				{open ? (
					<CliToolForm
						tool={tool}
						taken={taken}
						onDone={(name) => {
							onOpenChange(false);
							if (name) onSaved(name);
						}}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function CliToolForm({
	tool,
	taken,
	onDone,
}: {
	tool: CliTool | null;
	taken: string[];
	onDone: (name?: string) => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [name, setName] = useState(tool?.name ?? "");
	const [description, setDescription] = useState(tool?.description ?? "");
	const programs = useQuery({
		...orpc.cliTools.programs.queryOptions(),
		enabled: tool === null,
		staleTime: 5 * 60_000,
		meta: { quietErrors: true },
	});
	const save = useMutation(
		orpc.cliTools.save.mutationOptions({
			onSuccess: (saved) => {
				toast.success(tool ? `Saved ${saved.name}` : `Added ${saved.name}`);
				void queryClient.invalidateQueries({
					queryKey: orpc.cliTools.list.key(),
				});
				onDone(saved.name);
			},
		}),
	);

	const trimmed = name.trim();
	const available = (programs.data ?? []).filter((p) => !taken.includes(p));
	const query = trimmed.toLowerCase();
	const matches = available.filter((p) => p.toLowerCase().includes(query));
	// The names that start with what was typed come first.
	matches.sort(
		(a, b) =>
			Number(!a.toLowerCase().startsWith(query)) -
			Number(!b.toLowerCase().startsWith(query)),
	);
	const shown = matches.slice(0, SHOWN);
	const invalid = trimmed !== "" && !PROGRAM.test(trimmed);
	const exists = tool === null && taken.includes(trimmed);
	const notFound =
		tool === null &&
		programs.data !== undefined &&
		PROGRAM.test(trimmed) &&
		!exists &&
		!programs.data.includes(trimmed);
	const canSave = PROGRAM.test(trimmed) && !exists;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canSave) return;
				save.mutate({
					name: trimmed,
					description: description.trim() || undefined,
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>{tool ? `Edit ${tool.name}` : "Add CLI tool"}</DialogTitle>
				<DialogDescription>
					Pick a program on this computer. Agents with this tool run it without
					asking.
				</DialogDescription>
			</DialogHeader>

			<FieldGroup className="gap-5">
				{tool ? null : (
					<Field data-invalid={invalid || exists || undefined}>
						<FieldLabel htmlFor={`${id}-name`}>Program</FieldLabel>
						<Combobox
							items={available}
							filteredItems={shown}
							filter={null}
							value={available.includes(trimmed) ? trimmed : null}
							inputValue={name}
							onInputValueChange={setName}
							onValueChange={(next: string | null) => {
								if (next) setName(next);
							}}
						>
							<ComboboxInput
								id={`${id}-name`}
								className="w-full font-mono"
								placeholder="gh"
								autoComplete="off"
								spellCheck={false}
								autoFocus
								aria-invalid={invalid || exists || undefined}
								aria-describedby={`${id}-name-hint`}
							/>
							<ComboboxContent>
								<ComboboxEmpty>
									{programs.isPending
										? "Looking for programs…"
										: "No program with that name on this computer."}
								</ComboboxEmpty>
								<ComboboxList>
									{(program: string) => (
										<ComboboxItem
											key={program}
											value={program}
											className="font-mono"
										>
											{program}
										</ComboboxItem>
									)}
								</ComboboxList>
							</ComboboxContent>
						</Combobox>
						{invalid ? (
							<FieldError id={`${id}-name-hint`}>
								Type the program name only, for example gh or aws.
							</FieldError>
						) : exists ? (
							<FieldError id={`${id}-name-hint`}>
								{trimmed} is a CLI tool already.
							</FieldError>
						) : notFound ? (
							<FieldDescription
								id={`${id}-name-hint`}
								className="text-status-waiting"
							>
								Night Shift cannot find {trimmed} on this computer. Flows with
								it do not start until you install it.
							</FieldDescription>
						) : (
							<FieldDescription id={`${id}-name-hint`}>
								{matches.length > SHOWN
									? `${matches.length} programs. Type to narrow the list.`
									: "Profiles and Agent nodes name it like this."}
							</FieldDescription>
						)}
					</Field>
				)}

				<Field>
					<FieldLabel htmlFor={`${id}-description`}>
						Description{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
					</FieldLabel>
					<Input
						id={`${id}-description`}
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						placeholder="What the agents use it for"
						autoComplete="off"
						autoFocus={tool !== null}
					/>
					<FieldDescription>
						Agents read this before the help text of the program. Example:
						"Jira: read and update issues in the PROJ project."
					</FieldDescription>
				</Field>

				{save.error ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>Not saved</AlertTitle>
						<AlertDescription>{save.error.message}</AlertDescription>
					</Alert>
				) : null}
			</FieldGroup>

			<DialogFooter>
				<DialogClose render={<Button variant="outline" type="button" />}>
					Cancel
				</DialogClose>
				<Button type="submit" disabled={!canSave || save.isPending}>
					{save.isPending ? <Spinner data-icon="inline-start" /> : null}
					{tool ? "Save" : "Add CLI tool"}
				</Button>
			</DialogFooter>
		</form>
	);
}
