import { Alert, AlertDescription } from "@nightshift/ui/components/alert";
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
import { Checkbox } from "@nightshift/ui/components/checkbox";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldTitle,
} from "@nightshift/ui/components/field";
import { Input } from "@nightshift/ui/components/input";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	NativeSelect,
	NativeSelectOption,
} from "@nightshift/ui/components/native-select";
import {
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import { Textarea } from "@nightshift/ui/components/textarea";
import {
	ToggleGroup,
	ToggleGroupItem,
} from "@nightshift/ui/components/toggle-group";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BotIcon, CircleAlertIcon, WorkflowIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { CliCheckBadge } from "@/components/connections/cli-panel";
import { KindBadge } from "@/components/connections/parts";
import type { Connection } from "@/components/connections/types";
import { EFFORTS, PERMISSION_MODES } from "@/lib/agent-options";
import type { Effort, PermissionMode } from "@/lib/api-types";
import { harnessInfo } from "@/lib/harnesses";
import { orpc } from "@/utils/orpc";

import { DetailSection, DetailShell } from "./detail-shell";
import { ModelCombobox, ModelSourceHint } from "./model-combobox";
import type {
	HarnessName,
	HarnessRow,
	ProfileInput,
	ProfileRow,
} from "./types";

const NAME = /^[a-z][a-z0-9_]{0,39}$/;

type Draft = Omit<ProfileInput, "previousName" | "tools" | "connections"> &
	Required<Pick<ProfileInput, "tools" | "connections">>;

function draftFrom(profile: ProfileRow): Draft {
	const { usedBy: _usedBy, updatedAt: _at, ...rest } = profile;
	return { ...rest, description: rest.description ?? "" };
}

/** A new profile: the first added harness, its default model, the night's permission mode. */
export function newProfileDraft(
	harnesses: HarnessRow[],
	permissionMode: PermissionMode,
): Draft {
	const harness = harnesses[0]?.name ?? "claude-code";
	return {
		name: "",
		description: "",
		harness,
		model: harnessInfo(harness).defaultModel,
		permissionMode,
		tools: [],
		connections: [],
	};
}

/** Same values, whatever the key order or `undefined` fields. */
function same(a: Draft, b: Draft): boolean {
	const norm = (d: Draft) =>
		JSON.stringify({
			...d,
			description: d.description?.trim() ?? "",
			effort: d.effort ?? null,
		});
	return norm(a) === norm(b);
}

export function ProfileDetail({
	profile,
	initial,
	profiles,
	harnesses,
	connections,
	onSaved,
	onDeleted,
	onCancelNew,
	onDirtyChange,
}: {
	/** The saved profile; null while adding one. */
	profile: ProfileRow | null;
	/** What a new profile starts as. */
	initial: Draft;
	profiles: ProfileRow[];
	/** The added harnesses. */
	harnesses: HarnessRow[];
	connections: Connection[];
	onSaved: (name: string) => void;
	onDeleted: () => void;
	onCancelNew: () => void;
	/** Unsaved changes, so the page can ask before it shows something else. */
	onDirtyChange: (dirty: boolean) => void;
}) {
	const id = useId();
	const queryClient = useQueryClient();
	const saved = profile ? draftFrom(profile) : initial;
	const [draft, setDraft] = useState<Draft>(saved);
	const [deleting, setDeleting] = useState(false);
	const set = (patch: Partial<Draft>) =>
		setDraft((current) => ({ ...current, ...patch }));

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.profiles.key() });
	const save = useMutation(
		orpc.profiles.save.mutationOptions({
			onSuccess: (next) => {
				toast.success(profile ? `Saved ${next.name}` : `Added ${next.name}`);
				void invalidate();
				void queryClient.invalidateQueries({
					queryKey: orpc.harnesses.list.key(),
				});
				onSaved(next.name);
			},
		}),
	);
	const remove = useMutation(
		orpc.profiles.remove.mutationOptions({
			onSuccess: () => {
				toast.success(`Deleted ${profile?.name}`);
				void invalidate();
				onDeleted();
			},
			onError: (error) => toast.error(`Not deleted: ${error.message}`),
		}),
	);

	const name = draft.name.trim();
	const usedBy = profile?.usedBy ?? [];
	const nodeCount = usedBy.reduce((n, use) => n + use.nodeIds.length, 0);
	const nameInvalid = name !== "" && !NAME.test(name);
	const nameTaken =
		name !== profile?.name && profiles.some((p) => p.name === name);
	const dirty = !same(draft, saved);
	useEffect(() => {
		onDirtyChange(dirty);
	}, [dirty, onDirtyChange]);
	useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
	const canSave =
		NAME.test(name) && !nameTaken && draft.model.trim() !== "" && dirty;
	const harness = harnesses.find((h) => h.name === draft.harness);

	return (
		<DetailShell
			icon={<BotIcon />}
			kicker={profile ? "Agent profile" : "New agent profile"}
			title={name || "untitled"}
			mono
			subtitle={
				<span className="flex flex-wrap items-center gap-x-1.5">
					{harnessInfo(draft.harness).label}
					<span aria-hidden>·</span>
					<span className="font-mono">{draft.model || "no model"}</span>
					{draft.effort ? (
						<>
							<span aria-hidden>·</span>
							{draft.effort}
						</>
					) : null}
				</span>
			}
			actions={
				profile
					? [
							{
								label: "Delete",
								destructive: true,
								onSelect: () => setDeleting(true),
							},
						]
					: undefined
			}
			save={{
				isNew: !profile,
				dirty,
				canSave,
				pending: save.isPending,
				onSave: () =>
					save.mutate({
						...draft,
						name,
						description: draft.description?.trim() || undefined,
						model: draft.model.trim(),
						previousName: profile?.name,
					}),
				onDiscard: () => (profile ? setDraft(saved) : onCancelNew()),
			}}
		>
			{save.error ? (
				<Alert variant="destructive">
					<CircleAlertIcon />
					<AlertDescription>{save.error.message}</AlertDescription>
				</Alert>
			) : null}

			<DetailSection
				title="Name"
				description="Agent nodes pick the profile by this name."
			>
				<FieldGroup>
					<Field data-invalid={nameInvalid || nameTaken || undefined}>
						<FieldLabel htmlFor={`${id}-name`} className="sr-only">
							Name
						</FieldLabel>
						<Input
							id={`${id}-name`}
							value={draft.name}
							onChange={(event) => set({ name: event.target.value })}
							placeholder="builder"
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							autoFocus={!profile}
							disabled={usedBy.length > 0}
							aria-invalid={nameInvalid || nameTaken || undefined}
							aria-describedby={`${id}-name-hint`}
						/>
						{nameInvalid ? (
							<FieldError id={`${id}-name-hint`}>
								Use lowercase letters, digits and _, starting with a letter. Up
								to 40 characters.
							</FieldError>
						) : nameTaken ? (
							<FieldError id={`${id}-name-hint`}>
								A profile named {name} exists.
							</FieldError>
						) : usedBy.length > 0 ? (
							<FieldDescription id={`${id}-name-hint`}>
								Flows use this name, so you cannot change it.
							</FieldDescription>
						) : null}
					</Field>
					<Field>
						<FieldLabel htmlFor={`${id}-desc`}>What it is for</FieldLabel>
						<Textarea
							id={`${id}-desc`}
							rows={2}
							value={draft.description ?? ""}
							placeholder="Implements one trace overnight: edits, runs the tests, pushes."
							onChange={(event) => set({ description: event.target.value })}
						/>
					</Field>
				</FieldGroup>
			</DetailSection>

			<DetailSection
				title="Runs on"
				description="The coding agent and the model this profile uses."
			>
				<FieldGroup>
					<RadioGroup
						value={draft.harness}
						onValueChange={(next) => {
							const to = next as HarnessName;
							if (to === draft.harness) return;
							const known = harnessInfo(draft.harness).models.includes(
								draft.model,
							);
							set({
								harness: to,
								// A model from the old harness's list means nothing to the new one.
								model: known ? harnessInfo(to).defaultModel : draft.model,
							});
						}}
						className="grid gap-2 sm:grid-cols-3"
						aria-label="Harness"
					>
						{harnesses.map((h) => (
							<FieldLabel key={h.name} htmlFor={`${id}-h-${h.name}`}>
								<Field orientation="horizontal">
									<FieldContent>
										<FieldTitle>{h.label}</FieldTitle>
										<CliCheckBadge target={h.name} />
									</FieldContent>
									<RadioGroupItem value={h.name} id={`${id}-h-${h.name}`} />
								</Field>
							</FieldLabel>
						))}
					</RadioGroup>

					<Field>
						<FieldLabel htmlFor={`${id}-model`}>Model</FieldLabel>
						<ModelCombobox
							id={`${id}-model`}
							harness={draft.harness}
							value={draft.model}
							onChange={(model) => set({ model })}
							placeholder={harnessInfo(draft.harness).defaultModel}
							invalid={draft.model.trim() === ""}
							describedBy={`${id}-model-hint`}
						/>
						<FieldDescription id={`${id}-model-hint`} className="text-xs">
							<ModelSourceHint
								harness={draft.harness}
								listing={harness?.listing ?? null}
							/>
						</FieldDescription>
					</Field>

					<Field>
						<FieldLabel>Effort</FieldLabel>
						<ToggleGroup
							variant="outline"
							size="sm"
							spacing={0}
							value={[draft.effort ?? "default"]}
							onValueChange={(next: string[]) => {
								const pick = next[0];
								if (!pick) return;
								set({
									effort: pick === "default" ? undefined : (pick as Effort),
								});
							}}
						>
							<ToggleGroupItem value="default">Model default</ToggleGroupItem>
							{EFFORTS.map((effort) => (
								<ToggleGroupItem key={effort} value={effort}>
									{effort}
								</ToggleGroupItem>
							))}
						</ToggleGroup>
					</Field>
				</FieldGroup>
			</DetailSection>

			<DetailSection
				title="Permissions"
				description="What the agent may do without asking. Nobody is awake to answer at night."
			>
				<Field>
					<FieldLabel htmlFor={`${id}-perm`} className="sr-only">
						Permission mode
					</FieldLabel>
					<NativeSelect
						id={`${id}-perm`}
						value={draft.permissionMode}
						onChange={(event) =>
							set({ permissionMode: event.target.value as PermissionMode })
						}
					>
						{PERMISSION_MODES.map((mode) => (
							<NativeSelectOption key={mode.value} value={mode.value}>
								{mode.label}
							</NativeSelectOption>
						))}
					</NativeSelect>
					{draft.permissionMode === "bypassPermissions" ? (
						<FieldDescription className="text-status-waiting">
							The agent runs every tool, shell commands included, without
							asking.
						</FieldDescription>
					) : null}
				</Field>
			</DetailSection>

			<DetailSection
				title="Tools"
				description="Extra tools the agent can use, next to its built-in tools."
			>
				<div className="grid gap-2">
					<FieldLabel htmlFor={`${id}-t-github`}>
						<Field orientation="horizontal">
							<Checkbox
								id={`${id}-t-github`}
								checked={draft.tools.includes("github")}
								onCheckedChange={(on) =>
									set({
										tools: on
											? [...draft.tools.filter((t) => t !== "github"), "github"]
											: draft.tools.filter((t) => t !== "github"),
									})
								}
							/>
							<FieldContent>
								<FieldTitle className="font-mono">
									github
									<Badge variant="secondary">Built in</Badge>
								</FieldTitle>
								<FieldDescription className="text-xs">
									Read issues and pull requests, comment, set labels, and open a
									pull request with your own GitHub account.
								</FieldDescription>
							</FieldContent>
						</Field>
					</FieldLabel>
					{connections.map((c) => (
						<FieldLabel key={c.name} htmlFor={`${id}-c-${c.name}`}>
							<Field orientation="horizontal">
								<Checkbox
									id={`${id}-c-${c.name}`}
									checked={draft.connections.includes(c.name)}
									onCheckedChange={(on) =>
										set({
											connections: on
												? [...draft.connections, c.name]
												: draft.connections.filter((x) => x !== c.name),
										})
									}
								/>
								<FieldContent>
									<FieldTitle className="font-mono">
										{c.name}
										<KindBadge kind={"url" in c.server ? "url" : "command"} />
									</FieldTitle>
									{c.description ? (
										<FieldDescription className="text-xs">
											{c.description}
										</FieldDescription>
									) : null}
								</FieldContent>
							</Field>
						</FieldLabel>
					))}
					{connections.length === 0 ? (
						<p className="text-muted-foreground text-xs">
							Add an MCP server under Tools to use it here.
						</p>
					) : null}
				</div>
			</DetailSection>

			<DetailSection
				title="Used in flows"
				description="Agent nodes that use this profile. Your changes apply from their next run."
			>
				{usedBy.length === 0 ? (
					<p className="text-muted-foreground text-sm">No flow uses it yet.</p>
				) : (
					<ItemGroup className="gap-1">
						{usedBy.map((use) => (
							<Item
								key={`${use.projectId}/${use.flowName}`}
								size="xs"
								variant="outline"
								render={
									<Link
										to="/projects/$projectId/flows/$name"
										params={{ projectId: use.projectId, name: use.flowName }}
									/>
								}
							>
								<ItemMedia variant="icon">
									<WorkflowIcon />
								</ItemMedia>
								<ItemContent>
									<ItemTitle>
										<span className="text-muted-foreground">
											{use.projectName} /
										</span>
										<span className="font-mono">{use.flowName}</span>
									</ItemTitle>
									<ItemDescription className="font-mono text-xs">
										{use.nodeIds.join(", ")}
									</ItemDescription>
								</ItemContent>
							</Item>
						))}
					</ItemGroup>
				)}
			</DetailSection>

			<AlertDialog open={deleting} onOpenChange={setDeleting}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {profile?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							{nodeCount > 0
								? `${nodeCount} Agent ${nodeCount === 1 ? "node uses" : "nodes use"} it. ${nodeCount === 1 ? "Its flow" : "Their flows"} cannot run until you pick another profile.`
								: "No flow uses it."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => profile && remove.mutate({ name: profile.name })}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DetailShell>
	);
}
