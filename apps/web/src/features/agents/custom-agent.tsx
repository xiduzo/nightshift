import type { CustomAgent } from "@nightshift/flows";
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
	FieldLegend,
	FieldSet,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	BotIcon,
	CircleAlertIcon,
	PencilIcon,
	RefreshCwIcon,
	SquareTerminalIcon,
} from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import type { HarnessRow } from "@/shared/api";
import { formatDateTime, formatTime } from "@/shared/format";
import { useCliCheck } from "./connections/cli-panel";
import {
	type KeyValueRow,
	KeyValueRows,
	recordFrom,
	rowsFrom,
} from "./connections/key-value-rows";
import { FactList, OffMachineNote } from "./connections/parts";
import { DetailSection, DetailShell } from "./detail-shell";
import { connectionQueries, harnessMutations, harnessQueries } from "./queries";

/** `${NAME}`: a reference to a secret. */
const ref = (name: string) => `$\{${name}}`;

/** The name flows use for a custom agent: its name in lowercase, with dashes. */
export function slugOf(label: string): string {
	return label
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/, "");
}

/** `goose acp` → `goose`, `["acp"]`. Quotes keep spaces in one part. */
export function splitCommand(line: string): string[] {
	return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(
		(m) => m[1] ?? m[2] ?? m[3] ?? "",
	);
}

/** The command line as the person typed it, with quotes where a part has spaces. */
export function joinCommand(parts: readonly string[]): string {
	return parts.map((p) => (/\s/.test(p) || p === "" ? `"${p}"` : p)).join(" ");
}

/** "Add a custom agent", or edit one: its name, its command, its environment. */
export function CustomAgentDialog({
	open,
	onOpenChange,
	agent,
	taken,
	onSaved,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The agent to edit; null to add one. */
	agent: CustomAgent | null;
	/** The slugs in use. */
	taken: string[];
	onSaved: (slug: string) => void;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				{open ? (
					<CustomAgentForm
						agent={agent}
						taken={taken}
						onDone={(slug) => {
							onOpenChange(false);
							if (slug) onSaved(slug);
						}}
					/>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function CustomAgentForm({
	agent,
	taken,
	onDone,
}: {
	agent: CustomAgent | null;
	taken: string[];
	onDone: (slug?: string) => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const [label, setLabel] = useState(agent?.label ?? "");
	const [command, setCommand] = useState(
		agent ? joinCommand([agent.command, ...agent.args]) : "",
	);
	const [env, setEnv] = useState<KeyValueRow[]>(() => rowsFrom(agent?.env));
	const save = useMutation(
		harnessMutations.saveCustom({
			onSuccess: (saved) => {
				toast.success(agent ? `Saved ${saved.label}` : `Added ${saved.label}`);
				void queryClient.invalidateQueries({ queryKey: harnessQueries.all() });
				void queryClient.invalidateQueries({
					queryKey: connectionQueries.checks(),
				});
				onDone(saved.slug);
			},
		}),
	);

	const slug = agent?.slug ?? slugOf(label);
	const parts = splitCommand(command.trim());
	const exists = agent === null && slug !== "" && taken.includes(slug);
	const noSlug = label.trim() !== "" && slug === "";
	const canSave =
		label.trim() !== "" && slug !== "" && !exists && parts.length > 0;

	return (
		<form
			className="contents"
			onSubmit={(event) => {
				event.preventDefault();
				if (!canSave) return;
				const [bin = "", ...args] = parts;
				save.mutate({
					slug,
					label: label.trim(),
					command: bin,
					args,
					env: recordFrom(env),
					...(agent ? { previousSlug: agent.slug } : {}),
				});
			}}
		>
			<DialogHeader>
				<DialogTitle>
					{agent ? `Edit ${agent.label}` : "Add a custom agent"}
				</DialogTitle>
				<DialogDescription>
					Any coding agent that supports the Agent Client Protocol. Night Shift
					starts it with this command.
				</DialogDescription>
			</DialogHeader>

			<FieldGroup className="gap-5">
				<Field data-invalid={exists || noSlug || undefined}>
					<FieldLabel htmlFor={`${id}-label`}>Name</FieldLabel>
					<Input
						id={`${id}-label`}
						value={label}
						onChange={(event) => setLabel(event.target.value)}
						placeholder="Goose"
						autoComplete="off"
						autoFocus
						aria-invalid={exists || noSlug || undefined}
						aria-describedby={`${id}-label-hint`}
					/>
					{exists ? (
						<FieldError id={`${id}-label-hint`}>
							You have a custom agent with this name. Choose another name.
						</FieldError>
					) : noSlug ? (
						<FieldError id={`${id}-label-hint`}>
							Use at least one letter or digit.
						</FieldError>
					) : (
						<FieldDescription id={`${id}-label-hint`}>
							{slug
								? `Flows name it acp:${slug}.`
								: "Profiles and Agent nodes show this name."}
						</FieldDescription>
					)}
				</Field>

				<Field>
					<FieldLabel htmlFor={`${id}-command`}>Command</FieldLabel>
					<Input
						id={`${id}-command`}
						value={command}
						onChange={(event) => setCommand(event.target.value)}
						placeholder="goose acp"
						className="font-mono"
						autoComplete="off"
						spellCheck={false}
						aria-describedby={`${id}-command-hint`}
					/>
					<FieldDescription id={`${id}-command-hint`}>
						For example: goose acp
					</FieldDescription>
				</Field>

				<FieldSet className="gap-3">
					<FieldLegend variant="label">
						Environment{" "}
						<span className="font-normal text-muted-foreground">
							(optional)
						</span>
					</FieldLegend>
					<FieldDescription>
						Use {ref("NAME")} for a key, for example {ref("GOOSE_API_KEY")}.
						Save its value under Secrets.
					</FieldDescription>
					<KeyValueRows
						rows={env}
						onChange={setEnv}
						keyLabel="Variable"
						keyPlaceholder="GOOSE_PROVIDER"
						valuePlaceholder="ollama"
						addLabel="Add variable"
					/>
				</FieldSet>

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
					{agent ? "Save" : "Add agent"}
				</Button>
			</DialogFooter>
		</form>
	);
}

/** A custom agent on the Agents page: its command, its check, its profiles. */
export function CustomAgentDetail({
	harness,
	agent,
	onEdit,
	onOpenProfile,
	onRemoved,
}: {
	harness: HarnessRow;
	agent: CustomAgent;
	onEdit: () => void;
	onOpenProfile: (name: string) => void;
	onRemoved: () => void;
}) {
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState(false);
	const check = useCliCheck(harness.name);
	const data = check.data;
	const remove = useMutation(
		harnessMutations.remove({
			onSuccess: () => {
				toast.success(`Removed ${agent.label}`);
				void queryClient.invalidateQueries({ queryKey: harnessQueries.all() });
				onRemoved();
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);
	const variables = Object.keys(agent.env);

	return (
		<DetailShell
			icon={<SquareTerminalIcon />}
			kicker="Custom agent"
			title={agent.label}
			subtitle={harness.offMachine}
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
				description={`Night Shift starts ${agent.label} with this command. Flows name it ${harness.name}.`}
			>
				<div className="flex flex-col gap-4">
					{check.isPending ? (
						<div className="flex flex-col gap-2.5" aria-hidden>
							<Skeleton className="h-4 w-3/4" />
							<Skeleton className="h-4 w-1/2" />
						</div>
					) : (
						<FactList
							facts={[
								{
									label: "Command",
									value: (
										<span className="font-mono text-xs leading-5">
											{joinCommand([agent.command, ...agent.args])}
										</span>
									),
								},
								{
									label: "Path",
									value: (
										<span className="font-mono text-xs leading-5">
											{data?.path ?? (
												<span className="text-muted-foreground">
													{agent.command} not found
												</span>
											)}
										</span>
									),
								},
								...(data?.version
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
								...(variables.length > 0
									? [
											{
												label: "Environment",
												value: (
													<span className="font-mono text-xs leading-5">
														{variables.join(", ")}
													</span>
												),
											},
										]
									: []),
							]}
						/>
					)}
					{data?.problem ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertDescription>{data.problem}</AlertDescription>
						</Alert>
					) : check.error && !data ? (
						<Alert variant="destructive">
							<CircleAlertIcon />
							<AlertTitle>The check did not run</AlertTitle>
							<AlertDescription>{check.error.message}</AlertDescription>
						</Alert>
					) : null}
					<OffMachineNote>{harness.offMachine}</OffMachineNote>
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
						<Button variant="ghost" size="sm" onClick={onEdit}>
							<PencilIcon data-icon="inline-start" />
							Edit
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
				</div>
			</DetailSection>

			<DetailSection
				title="Models"
				description={`Model default uses the model ${agent.label} is set to.`}
			>
				<p className="text-muted-foreground text-sm">
					To use another model, type its name on a profile or an Agent node, for
					example ollama/qwen3-coder:latest. {agent.label} must offer it.
				</p>
			</DetailSection>

			<DetailSection
				title="Profiles on it"
				description="A custom agent with profiles cannot be removed."
			>
				{harness.profiles.length === 0 ? (
					<p className="text-muted-foreground text-sm">None yet.</p>
				) : (
					<div className="flex flex-wrap gap-1.5">
						{harness.profiles.map((name) => (
							<Button
								key={name}
								variant="secondary"
								size="xs"
								className="font-mono"
								onClick={() => onOpenProfile(name)}
							>
								<BotIcon data-icon="inline-start" />
								{name}
							</Button>
						))}
					</div>
				)}
			</DetailSection>

			<AlertDialog open={removing} onOpenChange={setRemoving}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{harness.profiles.length > 0
								? "Profiles run on it"
								: `Remove ${agent.label}?`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{harness.profiles.length > 0
								? `Move ${harness.profiles.join(", ")} to another harness first.`
								: `Agent nodes that use ${agent.label} cannot run until you add it again.`}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							{harness.profiles.length > 0 ? "OK" : "Cancel"}
						</AlertDialogCancel>
						{harness.profiles.length > 0 ? null : (
							<AlertDialogAction
								variant="destructive"
								disabled={remove.isPending}
								onClick={() => remove.mutate({ harness: harness.name })}
							>
								Remove
							</AlertDialogAction>
						)}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DetailShell>
	);
}
