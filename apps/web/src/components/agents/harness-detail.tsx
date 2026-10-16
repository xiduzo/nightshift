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
import { BotIcon, SquareTerminalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
	CliCheckBadge,
	CliPanel,
	toolFor,
} from "@/components/connections/cli-panel";
import { MonoTile } from "@/components/connections/parts";
import type { SettingsView } from "@/components/connections/types";
import { orpc } from "@/utils/orpc";

import { DetailSection, DetailShell } from "./detail-shell";
import { ModelSourceHint, useHarnessModels } from "./model-combobox";
import type { HarnessName, HarnessRow } from "./types";

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
		orpc.harnesses.remove.mutationOptions({
			onSuccess: () => {
				toast.success(`Removed ${harness.label}`);
				void queryClient.invalidateQueries({
					queryKey: orpc.harnesses.key(),
				});
				onRemoved();
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);
	const tool = toolFor(harness.name);

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
						? `The models Night Shift knows, plus the ones ${harness.label} has on this computer. Profiles and Agent nodes pick from these.`
						: `The models Night Shift knows. ${harness.label} also takes any other model it supports.`
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
				description="A harness with profiles cannot be removed."
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
								: `Remove ${harness.label}?`}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{harness.profiles.length > 0
								? `Move ${harness.profiles.join(", ")} to another harness first.`
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

/** "Add a harness": every TanStack AI harness adapter, with what this machine has. */
export function HarnessPicker({
	open,
	onOpenChange,
	harnesses,
	onAdded,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	harnesses: HarnessRow[] | undefined;
	onAdded: (name: HarnessName) => void;
}) {
	const queryClient = useQueryClient();
	const add = useMutation(
		orpc.harnesses.add.mutationOptions({
			onSuccess: (_, input) => {
				void queryClient.invalidateQueries({
					queryKey: orpc.harnesses.key(),
				});
				onOpenChange(false);
				onAdded(input.harness);
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
					{(harnesses ?? []).map((h) => (
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
				</ItemGroup>
			</DialogContent>
		</Dialog>
	);
}
