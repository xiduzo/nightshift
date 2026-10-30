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
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BotIcon, PlusIcon, SquareTerminalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type {
	CheckTarget,
	HarnessRow,
	HarnessRowName,
	SettingsView,
} from "@/shared/api";
import { DetailSection, DetailShell } from "@/shared/detail";
import { CliCheckBadge, CliPanel, toolFor } from "./connections/cli-panel";
import { MonoTile } from "./connections/parts";
import type { BuiltInHarnessName } from "./harnesses";
import { ModelSourceHint, useHarnessModels } from "./model-combobox";
import { harnessMutations, harnessQueries } from "./queries";

export function HarnessDetail({
	harness,
	settings,
	onOpenProfile,
	onRemoved,
}: {
	harness: HarnessRow;
	settings: SettingsView | undefined;
	onOpenProfile: (name: string) => void;
	onRemoved: () => void;
}) {
	const queryClient = useQueryClient();
	const [removing, setRemoving] = useState(false);
	const models = useHarnessModels(harness.name);
	const remove = useMutation(
		harnessMutations.remove({
			onSuccess: () => {
				toast.success(`Removed ${harness.label}`);
				void queryClient.invalidateQueries({
					queryKey: harnessQueries.all(),
				});
				onRemoved();
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);
	const tool = toolFor(harness.name as CheckTarget);

	return (
		<DetailShell
			icon={<SquareTerminalIcon />}
			kicker="Harness"
			title={harness.label}
			subtitle={tool.offMachine(undefined)}
			actions={[
				{
					label: "Remove",
					destructive: true,
					onSelect: () => setRemoving(true),
				},
			]}
		>
			<DetailSection
				title="On this computer"
				description={`Night Shift uses your own ${harness.label} and its login.`}
			>
				<CliPanel tool={tool} settings={settings} />
			</DetailSection>

			<DetailSection
				title="Models"
				description={
					harness.listing
						? `Known models and the ones ${harness.label} has on this computer. Profiles and Agent nodes pick from these.`
						: `Profiles and Agent nodes pick from these. ${harness.label} also takes any other model it supports.`
				}
			>
				<div className="flex flex-col gap-3">
					{models.isPending ? (
						<div className="flex flex-wrap gap-1.5" aria-hidden>
							{Array.from({ length: 6 }, (_, i) => (
								<Skeleton key={i} className="h-5 w-28 rounded-4xl" />
							))}
						</div>
					) : (
						<ul className="flex flex-wrap gap-1.5">
							{models.models.map((model) => (
								<li key={model}>
									<Badge
										variant={
											harness.models.includes(model) ? "outline" : "secondary"
										}
										className="font-mono"
									>
										{model}
									</Badge>
								</li>
							))}
						</ul>
					)}
					<p className="text-muted-foreground text-xs">
						<ModelSourceHint harness={harness.name} listing={harness.listing} />
					</p>
				</div>
			</DetailSection>

			<DetailSection
				title="Profiles on it"
				description="You cannot remove a harness that has profiles."
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
								? `${harness.label} has profiles`
								: `Remove ${harness.label}?`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{harness.profiles.length > 0
								? `Move ${harness.profiles.join(", ")} to another harness. Then you can remove ${harness.label}.`
								: `Agent nodes that use ${harness.label} cannot run until you add it again.`}
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

/**
 * "Add a harness": every TanStack AI harness adapter, with what this machine
 * has, then a custom agent: any agent that speaks ACP.
 */
export function HarnessPicker({
	open,
	onOpenChange,
	harnesses,
	onAdded,
	onAddCustom,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	harnesses: HarnessRow[] | undefined;
	onAdded: (name: HarnessRowName) => void;
	/** Opens the custom agent form. */
	onAddCustom: () => void;
}) {
	const queryClient = useQueryClient();
	const add = useMutation(
		harnessMutations.add({
			onSuccess: (_, input) => {
				void queryClient.invalidateQueries({
					queryKey: harnessQueries.all(),
				});
				onOpenChange(false);
				onAdded(input.harness as HarnessRowName);
			},
			onError: (error) => toast.error(`Not added: ${error.message}`),
		}),
	);
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add a harness</DialogTitle>
					<DialogDescription>
						Pick the coding agent your profiles use. It runs on this computer
						with your own login.
					</DialogDescription>
				</DialogHeader>
				<ItemGroup className="gap-2">
					{(harnesses ?? [])
						.flatMap((h) =>
							h.custom ? [] : [{ ...h, name: h.name as BuiltInHarnessName }],
						)
						.map((h) => (
							<Item
								key={h.name}
								variant="outline"
								render={
									<button
										type="button"
										disabled={h.added || add.isPending}
										className="text-left disabled:opacity-60"
									/>
								}
								onClick={() => add.mutate({ harness: h.name })}
							>
								<ItemMedia>
									<MonoTile>{toolFor(h.name).initials}</MonoTile>
								</ItemMedia>
								<ItemContent>
									<ItemTitle>{h.label}</ItemTitle>
									<ItemDescription className="text-xs">
										{h.models.length} known models
									</ItemDescription>
								</ItemContent>
								<ItemActions>
									{h.added ? (
										<Badge variant="secondary">Added</Badge>
									) : (
										<CliCheckBadge target={h.name} />
									)}
								</ItemActions>
							</Item>
						))}
					<Item
						variant="outline"
						render={<button type="button" className="text-left" />}
						onClick={() => {
							onOpenChange(false);
							onAddCustom();
						}}
					>
						<ItemMedia variant="icon">
							<PlusIcon />
						</ItemMedia>
						<ItemContent>
							<ItemTitle>Custom agent</ItemTitle>
							<ItemDescription className="text-xs">
								Any coding agent that supports the Agent Client Protocol, such
								as Goose or Qwen Code.
							</ItemDescription>
						</ItemContent>
					</Item>
				</ItemGroup>
			</DialogContent>
		</Dialog>
	);
}
