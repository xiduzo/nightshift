/** A Model Profile on the Agents page: the decider and the model that Decisions and Values decided by a model use. */
import type { DeciderName } from "@nightshift/flows";
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
	RadioGroup,
	RadioGroupItem,
} from "@nightshift/ui/components/radio-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlertIcon, SparklesIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import type { ModelProfileRow, ProfileRow } from "@/shared/api";
import { DetailSection, DetailShell } from "@/shared/detail";
import { LargerTextarea } from "@/shared/larger-window";
import { ProfileUsedIn } from "./profile-sections";
import { deciderQueries, profileMutations, profileQueries } from "./queries";

const NAME = /^[a-z][a-z0-9_]{0,39}$/;

type Draft = {
	name: string;
	description: string;
	decider: DeciderName;
	/** Empty: each node uses the decider's default model. */
	model: string;
};

function draftFrom(profile: ModelProfileRow): Draft {
	return {
		name: profile.name,
		description: profile.description ?? "",
		decider: profile.decider,
		model: profile.model ?? "",
	};
}

/** A new Model Profile: the decider new Decision nodes start on, its default model. */
export function newModelProfileDraft(decider: DeciderName): Draft {
	return { name: "", description: "", decider, model: "" };
}

const same = (a: Draft, b: Draft) =>
	a.name === b.name &&
	a.description.trim() === b.description.trim() &&
	a.decider === b.decider &&
	a.model.trim() === b.model.trim();

export function ModelProfileDetail({
	profile,
	initial,
	profiles,
	onSaved,
	onDeleted,
	onCancelNew,
	onDirtyChange,
}: {
	/** The saved profile; null while adding one. */
	profile: ModelProfileRow | null;
	/** What a new profile starts as. */
	initial: Draft;
	profiles: ProfileRow[];
	/** Gets the saved profile's id. */
	onSaved: (id: string) => void;
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
	const deciders = useQuery(deciderQueries.list());
	const decider = deciders.data?.find((d) => d.name === draft.decider);
	const set = (patch: Partial<Draft>) =>
		setDraft((current) => ({ ...current, ...patch }));

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: profileQueries.all() });
	const save = useMutation(
		profileMutations.save({
			onSuccess: (next) => {
				toast.success(profile ? `Saved ${next.name}` : `Added ${next.name}`);
				void invalidate();
				onSaved(next.id);
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
	const nameTaken = profiles.some(
		(p) => p.name === name && p.id !== profile?.id,
	);
	const dirty = !same(draft, saved);
	useEffect(() => {
		onDirtyChange(dirty);
	}, [dirty, onDirtyChange]);
	useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
	const canSave = NAME.test(name) && !nameTaken && dirty;
	const keyMissing = decider?.apiKeySource === "missing";
	const defaults = decider
		? decider.value && decider.value.defaultModel !== decider.defaultModel
			? `${decider.defaultModel} to decide, ${decider.value.defaultModel} to make a value`
			: decider.defaultModel
		: "";

	return (
		<DetailShell
			icon={<SparklesIcon />}
			kicker={profile ? "Model profile" : "New model profile"}
			title={name || "untitled"}
			mono
			subtitle={
				<span className="flex flex-wrap items-center gap-x-1.5">
					{decider?.label ?? draft.decider}
					<span aria-hidden>·</span>
					<span className="font-mono">
						{draft.model.trim() || "default model"}
					</span>
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
						name,
						decider: draft.decider,
						...(draft.model.trim() ? { model: draft.model.trim() } : {}),
						description: draft.description.trim() || undefined,
						id: profile?.id,
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
				description="Decision and Value nodes pick the profile by this name."
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
							placeholder="triage"
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
								Start with a letter. Use lowercase letters, digits and _, up to
								40 characters.
							</FieldError>
						) : nameTaken ? (
							<FieldError id={`${id}-name-hint`}>
								A profile named {name} already exists. Pick another name.
							</FieldError>
						) : usedBy.length > 0 ? (
							<FieldDescription id={`${id}-name-hint`}>
								Flows use this name, so you cannot change it.
							</FieldDescription>
						) : null}
					</Field>
					<Field>
						<FieldLabel htmlFor={`${id}-desc`}>What it is for</FieldLabel>
						<LargerTextarea
							title="What it is for"
							id={`${id}-desc`}
							rows={2}
							value={draft.description}
							placeholder="Small, cheap calls: is the build green, which task is next."
							onChange={(event) => set({ description: event.target.value })}
						/>
					</Field>
				</FieldGroup>
			</DetailSection>

			<DetailSection
				title="Decider"
				description="The model provider that picks an option or makes a value."
			>
				<FieldGroup>
					<RadioGroup
						value={draft.decider}
						onValueChange={(next) => {
							const to = next as DeciderName;
							// A model belongs to its decider: the new one starts on its default.
							if (to !== draft.decider) set({ decider: to, model: "" });
						}}
						className="grid gap-2 sm:grid-cols-2"
						aria-label="Decider"
					>
						{(deciders.data ?? []).map((d) => (
							<FieldLabel key={d.name} htmlFor={`${id}-d-${d.name}`}>
								<Field orientation="horizontal">
									<FieldContent>
										<FieldTitle>
											{d.label}
											{d.value ? null : (
												<Badge variant="outline">Decisions only</Badge>
											)}
										</FieldTitle>
										{d.apiKeySource === "missing" ? (
											<FieldDescription className="text-status-waiting text-xs">
												Needs the secret {d.apiKey}
											</FieldDescription>
										) : null}
									</FieldContent>
									<RadioGroupItem value={d.name} id={`${id}-d-${d.name}`} />
								</Field>
							</FieldLabel>
						))}
					</RadioGroup>
					{keyMissing && decider?.apiKey ? (
						<Alert>
							<CircleAlertIcon />
							<AlertDescription>
								Nodes on this profile cannot decide without the secret{" "}
								{decider.apiKey}. Add it under Secrets.
							</AlertDescription>
						</Alert>
					) : null}

					<Field>
						<FieldLabel htmlFor={`${id}-model`}>Model</FieldLabel>
						<Input
							id={`${id}-model`}
							list={`${id}-models`}
							value={draft.model}
							placeholder={decider?.defaultModel}
							className="font-mono"
							autoComplete="off"
							spellCheck={false}
							aria-describedby={`${id}-model-hint`}
							onChange={(event) => set({ model: event.target.value })}
						/>
						<datalist id={`${id}-models`}>
							{[
								...new Set([
									...(decider?.models ?? []),
									...(decider?.value?.models ?? []),
								]),
							].map((value) => (
								<option key={value} value={value} />
							))}
						</datalist>
						<FieldDescription id={`${id}-model-hint`} className="text-xs">
							{defaults
								? `Leave it empty to use the default: ${defaults}.`
								: "Leave it empty to use the decider's default model."}
						</FieldDescription>
					</Field>
				</FieldGroup>
			</DetailSection>

			<ProfileUsedIn usedBy={usedBy} />

			<AlertDialog open={deleting} onOpenChange={setDeleting}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete {profile?.name}?</AlertDialogTitle>
						<AlertDialogDescription>
							{nodeCount > 0
								? `${nodeCount} ${nodeCount === 1 ? "node uses" : "nodes use"} it. ${nodeCount === 1 ? "Its flow" : "Their flows"} cannot run until you pick another profile.`
								: "No flow uses it."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={remove.isPending}
							onClick={() => profile && remove.mutate({ id: profile.id })}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</DetailShell>
	);
}
