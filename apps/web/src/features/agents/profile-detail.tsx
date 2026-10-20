import type { CustomAgent } from "@nightshift/flows";
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
import { Button } from "@nightshift/ui/components/button";
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
	ItemActions,
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	BotIcon,
	CircleAlertIcon,
	ShareIcon,
	SquareTerminalIcon,
	WorkflowIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import type {
	CliTool,
	Connection,
	Effort,
	HarnessRow,
	HarnessRowName,
	OfferView,
	PermissionMode,
	ProfileInput,
	ProfileRow,
} from "@/shared/api";
import { EFFORTS, PERMISSION_MODES, permissionLabel } from "./agent-options";
import { CliCheckBadge } from "./connections/cli-panel";
import { KindBadge } from "./connections/parts";
import { DetailSection, DetailShell } from "./detail-shell";
import { harnessInfo } from "./harnesses";
import { ModelCombobox, ModelSourceHint } from "./model-combobox";
import { OfferDialog, WithdrawOfferDialog } from "./offer-dialog";
import {
	harnessQueries,
	offerQueries,
	profileMutations,
	profileQueries,
} from "./queries";

const NAME = /^[a-z][a-z0-9_]{0,39}$/;

type Draft = Omit<ProfileInput, "previousName" | "clis" | "connections"> &
	Required<Pick<ProfileInput, "clis" | "connections">>;

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
		model: harnessInfo(harness, customAgentsOf(harnesses)).defaultModel,
		permissionMode,
		clis: [],
		connections: [],
	};
}

/** The custom agents among the harness rows. */
function customAgentsOf(harnesses: HarnessRow[]): CustomAgent[] {
	return harnesses.flatMap((h) => (h.custom ? [h.custom] : []));
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
	cliTools,
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
	cliTools: CliTool[];
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
	const [offering, setOffering] = useState(false);
	const [withdrawing, setWithdrawing] = useState<OfferView | null>(null);
	const offers = useQuery({
		...offerQueries.list(),
		enabled: profile !== null,
	});
	const offered = (offers.data?.offers ?? []).filter(
		(o) => o.profile === profile?.name,
	);
	const set = (patch: Partial<Draft>) =>
		setDraft((current) => ({ ...current, ...patch }));

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: profileQueries.all() });
	const save = useMutation(
		profileMutations.save({
			onSuccess: (next) => {
				toast.success(profile ? `Saved ${next.name}` : `Added ${next.name}`);
				void invalidate();
				void queryClient.invalidateQueries({
					queryKey: harnessQueries.lists(),
				});
				onSaved(next.name);
			},
		}),
	);
	const remove = useMutation(
		profileMutations.remove({
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
	const customAgents = customAgentsOf(harnesses);
	const info = (name: HarnessRowName) => harnessInfo(name, customAgents);

	return (
		<DetailShell
			icon={<BotIcon />}
			kicker={profile ? "Agent profile" : "New agent profile"}
			title={name || "untitled"}
			mono
			subtitle={
				<span className="flex flex-wrap items-center gap-x-1.5">
					{info(draft.harness).label}
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
								label: "Offer to a Space…",
								onSelect: () => setOffering(true),
							},
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
							const to = next as HarnessRowName;
							if (to === draft.harness) return;
							const known = info(draft.harness).models.includes(draft.model);
							set({
								harness: to,
								// A model from the old harness's list means nothing to the new one.
								model: known ? info(to).defaultModel : draft.model,
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
							placeholder={info(draft.harness).defaultModel}
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
				description="What the agents can use. They run the CLI tools without asking. The permission mode decides about all other commands."
			>
				<div className="grid gap-2">
					{cliTools.map((t) => (
						<FieldLabel key={t.name} htmlFor={`${id}-cli-${t.name}`}>
							<Field orientation="horizontal">
								<Checkbox
									id={`${id}-cli-${t.name}`}
									checked={draft.clis.includes(t.name)}
									onCheckedChange={(on) =>
										set({
											clis: on
												? [...draft.clis, t.name]
												: draft.clis.filter((x) => x !== t.name),
										})
									}
								/>
								<FieldContent>
									<FieldTitle className="font-mono">
										{t.name}
										<Badge variant="secondary">
											<SquareTerminalIcon
												data-icon="inline-start"
												aria-hidden
											/>
											CLI
										</Badge>
									</FieldTitle>
									{t.description ? (
										<FieldDescription className="text-xs">
											{t.description}
										</FieldDescription>
									) : null}
								</FieldContent>
							</Field>
						</FieldLabel>
					))}
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
					{cliTools.length === 0 && connections.length === 0 ? (
						<p className="text-muted-foreground text-xs">
							Add a CLI tool or an MCP server under Tools, then pick it here.
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

			{profile ? (
				<DetailSection
					title="Offered to Spaces"
					description="People in these Spaces can run this profile on this computer, with your login and your tools."
				>
					{offered.length === 0 ? (
						<div className="flex flex-wrap items-center gap-3">
							<p className="text-muted-foreground text-sm">Only you run it.</p>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setOffering(true)}
							>
								<ShareIcon data-icon="inline-start" />
								Offer to a Space…
							</Button>
						</div>
					) : (
						<ItemGroup className="gap-1">
							{offered.map((offer) => (
								<Item key={offer.spaceId} size="xs" variant="outline">
									<ItemContent>
										<ItemTitle>
											{offer.spaceName}
											{offer.listed ? null : (
												<Badge variant="outline">Withdrawn in the Space</Badge>
											)}
										</ItemTitle>
										<ItemDescription className="text-xs">
											{permissionLabel(offer.permissionCap)} at most.{" "}
											{offer.sessionCap === 1
												? "One session at once."
												: `${offer.sessionCap} sessions at once.`}
										</ItemDescription>
									</ItemContent>
									<ItemActions>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setWithdrawing(offer)}
										>
											Withdraw
										</Button>
									</ItemActions>
								</Item>
							))}
						</ItemGroup>
					)}
				</DetailSection>
			) : null}

			{profile ? (
				<OfferDialog
					profile={profile.name}
					open={offering}
					onOpenChange={setOffering}
				/>
			) : null}
			<WithdrawOfferDialog
				offer={withdrawing}
				onOpenChange={(open) => {
					if (!open) setWithdrawing(null);
				}}
			/>

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
