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
	FieldSeparator,
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
import { CodeView } from "@/shared/code";
import { DetailSection, DetailShell } from "@/shared/detail";
import { checkState } from "./connections/cli-panel";
import { CheckBadge, FactList } from "./connections/parts";
import {
	cliToolMutations,
	cliToolQueries,
	connectionQueries,
	profileQueries,
} from "./queries";
import { UsedBySection } from "./tool-detail";
import { LoginFields, LoginSection } from "./tool-login";
import { gitOf, loginDraftOf, loginOf, loginProblem } from "./tool-login-draft";

/** The program name only: what a shell types to run it. */
const PROGRAM = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;

/** At most this many programs show in the list; typing narrows it. */
const SHOWN = 50;

/** Where the program is and its version, asked once and kept a while. */
export function useCliToolCheck(name: string) {
	return useQuery({
		...cliToolQueries.check(name),
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
		cliToolMutations.remove({
			onSuccess: () => {
				toast.success(`Removed ${tool.name}`);
				void queryClient.invalidateQueries({
					queryKey: cliToolQueries.lists(),
				});
				void queryClient.invalidateQueries({ queryKey: profileQueries.all() });
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

			<LoginSection tool={tool} />

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
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
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
	const [program, setProgram] = useState(tool?.program ?? tool?.name ?? "");
	// A new tool is named after its program until the person names it.
	const [name, setName] = useState(tool?.name ?? "");
	const [named, setNamed] = useState(tool !== null);
	const [description, setDescription] = useState(tool?.description ?? "");
	const [login, setLogin] = useState(() => loginDraftOf(tool));
	const programs = useQuery({
		...cliToolQueries.programs(),
		staleTime: 5 * 60_000,
		meta: { quietErrors: true },
	});
	const save = useMutation(
		cliToolMutations.save({
			onSuccess: (saved) => {
				toast.success(tool ? `Saved ${saved.name}` : `Added ${saved.name}`);
				void queryClient.invalidateQueries({
					queryKey: cliToolQueries.lists(),
				});
				void queryClient.invalidateQueries({
					queryKey: connectionQueries.lists(),
				});
				onDone(saved.name);
			},
		}),
	);

	const trimmedProgram = program.trim();
	const trimmed = (named ? name : program).trim();
	const available = programs.data ?? [];
	const query = trimmedProgram.toLowerCase();
	const matches = available.filter((p) => p.toLowerCase().includes(query));
	// The names that start with what was typed come first.
	matches.sort(
		(a, b) =>
			Number(!a.toLowerCase().startsWith(query)) -
			Number(!b.toLowerCase().startsWith(query)),
	);
	const shown = matches.slice(0, SHOWN);
	const programInvalid = trimmedProgram !== "" && !PROGRAM.test(trimmedProgram);
	const nameInvalid = trimmed !== "" && !PROGRAM.test(trimmed);
	const exists = tool === null && taken.includes(trimmed);
	const notFound =
		programs.data !== undefined &&
		PROGRAM.test(trimmedProgram) &&
		!programs.data.includes(trimmedProgram);
	const problem = loginProblem(login);
	const canSave =
		PROGRAM.test(trimmedProgram) &&
		PROGRAM.test(trimmed) &&
		!exists &&
		problem === null;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canSave) return;
				const savedLogin = loginOf(login);
				const git = gitOf(login);
				save.mutate({
					name: trimmed,
					...(trimmedProgram !== trimmed ? { program: trimmedProgram } : {}),
					description: description.trim() || undefined,
					...(savedLogin ? { login: savedLogin } : {}),
					...(git ? { git } : {}),
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>{tool ? `Edit ${tool.name}` : "Add CLI tool"}</DialogTitle>
				<DialogDescription>
					Pick a program on this computer. Agents with this tool run it without
					asking. Add a tool for each account of a program, for example gh and
					gh-work.
				</DialogDescription>
			</DialogHeader>

			<FieldGroup className="gap-5">
				<Field data-invalid={programInvalid || undefined}>
					<FieldLabel htmlFor={`${id}-program`}>Program</FieldLabel>
					<Combobox
						items={available}
						filteredItems={shown}
						filter={null}
						value={available.includes(trimmedProgram) ? trimmedProgram : null}
						inputValue={program}
						onInputValueChange={setProgram}
						onValueChange={(next: string | null) => {
							if (next) setProgram(next);
						}}
					>
						<ComboboxInput
							id={`${id}-program`}
							className="w-full font-mono"
							placeholder="gh"
							autoComplete="off"
							spellCheck={false}
							autoFocus={tool === null}
							aria-invalid={programInvalid || undefined}
							aria-describedby={`${id}-program-hint`}
						/>
						<ComboboxContent>
							<ComboboxEmpty>
								{programs.isPending
									? "Looking for programs…"
									: "No program with that name on this computer."}
							</ComboboxEmpty>
							<ComboboxList>
								{(item: string) => (
									<ComboboxItem key={item} value={item} className="font-mono">
										{item}
									</ComboboxItem>
								)}
							</ComboboxList>
						</ComboboxContent>
					</Combobox>
					{programInvalid ? (
						<FieldError id={`${id}-program-hint`}>
							Type the program name only, for example gh or aws.
						</FieldError>
					) : notFound ? (
						<FieldDescription
							id={`${id}-program-hint`}
							className="text-status-waiting"
						>
							Night Shift cannot find {trimmedProgram} on this computer. Flows
							with this tool do not start until you install it.
						</FieldDescription>
					) : (
						<FieldDescription id={`${id}-program-hint`}>
							{matches.length > SHOWN
								? `${matches.length} programs. Type to narrow the list.`
								: "The program that runs when an agent uses this tool."}
						</FieldDescription>
					)}
				</Field>

				<Field data-invalid={nameInvalid || exists || undefined}>
					<FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
					<Input
						id={`${id}-name`}
						value={named ? name : program}
						onChange={(event) => {
							setNamed(true);
							setName(event.target.value);
						}}
						placeholder={trimmedProgram || "gh"}
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						disabled={tool !== null}
						aria-invalid={nameInvalid || exists || undefined}
						aria-describedby={`${id}-name-hint`}
					/>
					{nameInvalid ? (
						<FieldError id={`${id}-name-hint`}>
							Use letters, digits and . _ + -, for example gh-work.
						</FieldError>
					) : exists ? (
						<FieldError id={`${id}-name-hint`}>
							{trimmed} is a CLI tool already. Give this account another name,
							for example {trimmed}-work.
						</FieldError>
					) : (
						<FieldDescription id={`${id}-name-hint`}>
							Agents type this name to run it. Profiles and Agent nodes name it
							like this.
						</FieldDescription>
					)}
				</Field>

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
						Agents read this before the help text of the program. Say which
						account it is. Example: "GitHub as work-org. Use it for repositories
						under work-org/."
					</FieldDescription>
				</Field>

				<FieldSeparator />

				<LoginFields
					draft={login}
					onChange={setLogin}
					program={trimmedProgram}
					name={trimmed}
				/>

				{problem ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>Check the login</AlertTitle>
						<AlertDescription>{problem}</AlertDescription>
					</Alert>
				) : null}

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
