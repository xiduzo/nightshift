import {
	type Flow,
	type FlowNode,
	mainOutputField,
	NODE_FAMILY_LABEL,
	type ValuePresetName,
	type ValuePresetResult,
} from "@nightshift/flows";
import { Badge } from "@nightshift/ui/components/badge";
import {
	Command,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "@nightshift/ui/components/command";
import { cn } from "@nightshift/ui/lib/utils";
import { useState } from "react";
import { FAMILY_TILE, type PaletteItem } from "../../canvas/node-type";
import { PresetForm } from "../inspector/value-presets";
import { useProjectFolder } from "../project-folder-context";
import {
	type CatalogAdd,
	type CatalogEntry,
	type CatalogGroup,
	catalogGroups,
	NEEDS_FOLDER,
	offHere,
} from "./catalog";

const GROUPS = catalogGroups();

/**
 * The add-node dialog: every node and kit by family, with a search, and
 * "My kits" last. Tab or a double-click on the canvas opens it, and so
 * does the first button of the dock. A Value preset opens its form as the
 * dialog's second page. In a project without a folder, a kit or a flow
 * that needs one shows, but cannot be picked.
 */
export function AddNodeDialog({
	open,
	onOpenChange,
	flow,
	from,
	myKits,
	onAddNode,
	onAddKit,
	onUsePreset,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	flow: Flow;
	/** The one node selected: what takes a value goes after it and reads its main output. */
	from: FlowNode | null;
	/** The flows of the Space that another flow runs (`myKitEntries`). */
	myKits: readonly CatalogEntry[];
	onAddNode: (item: PaletteItem) => void;
	onAddKit: (add: Extract<CatalogAdd, { kind: "kit" }>) => void;
	onUsePreset: (made: ValuePresetResult) => void;
}) {
	const [preset, setPreset] = useState<ValuePresetName | null>(null);
	const folder = useProjectFolder();
	const reads = from ? `${from.id}.${mainOutputField(from)}` : null;
	const changeOpen = (next: boolean) => {
		if (!next) setPreset(null);
		onOpenChange(next);
	};
	const pick = (entry: CatalogEntry) => {
		if (entry.add.kind === "preset") {
			setPreset(entry.add.preset);
			return;
		}
		if (entry.add.kind === "kit") onAddKit(entry.add);
		else onAddNode(entry.add.item);
		changeOpen(false);
	};

	// `CommandDialog` keeps its hidden title on the page while it is shut:
	// mounted only while open, the page has no stray "Add a node" heading.
	if (!open) return null;
	return (
		<CommandDialog
			open={open}
			onOpenChange={changeOpen}
			title="Add a node"
			description="Find a node by what it does. Pick it to add it to the flow."
			className="sm:max-w-lg"
		>
			{preset === null ? (
				<Command loop>
					<CommandInput placeholder="Search nodes and kits" autoFocus />
					<CommandList className="max-h-[min(26rem,60svh)]">
						<CommandEmpty>
							No node or kit matches. Try another word.
						</CommandEmpty>
						{GROUPS.map((group) => (
							<CommandGroup
								key={`${group.family}:${group.takes}`}
								heading={groupHeading(group)}
							>
								{group.entries.map((entry) => (
									<CatalogItem
										key={entry.key}
										entry={entry}
										// A preset reads the list its form picks.
										reads={
											entry.takes === "value" && entry.add.kind === "node"
												? reads
												: null
										}
										off={offHere(entry, folder)}
										onPick={() => pick(entry)}
									/>
								))}
							</CommandGroup>
						))}
						{myKits.length > 0 ? (
							<CommandGroup heading="My kits">
								{myKits.map((entry) => (
									<CatalogItem
										key={entry.key}
										entry={entry}
										reads={null}
										off={offHere(entry, folder)}
										onPick={() => pick(entry)}
									/>
								))}
							</CommandGroup>
						) : null}
					</CommandList>
				</Command>
			) : (
				<div className="grid gap-6 p-6">
					<PresetForm
						preset={preset}
						flow={flow}
						replaces={false}
						from={from?.id}
						onUse={(made) => {
							onUsePreset(made);
							changeOpen(false);
						}}
						onBack={() => setPreset(null)}
					/>
				</div>
			)}
		</CommandDialog>
	);
}

/** A family's name, and after it "takes a value" for the group of nodes that read one. */
function groupHeading(group: CatalogGroup): string {
	const family = NODE_FAMILY_LABEL[group.family];
	return group.takes === "value" ? `${family} · takes a value` : family;
}

/**
 * One node, preset, kit or flow: its icon on a tile in its family's tint,
 * its name and what it does. With one node selected, what takes a value
 * shows what it reads. A kit says "Kit", a flow of another project its
 * project. One that is `off` here cannot be picked, and says why in
 * place of what it does.
 */
function CatalogItem({
	entry,
	reads,
	off,
	onPick,
}: {
	entry: CatalogEntry;
	reads: string | null;
	off: boolean;
	onPick: () => void;
}) {
	const Icon = entry.icon;
	const blurb = off ? NEEDS_FOLDER : entry.blurb;
	return (
		<CommandItem
			value={entry.key}
			keywords={[
				entry.label,
				NODE_FAMILY_LABEL[entry.family],
				...entry.keywords,
			]}
			disabled={off}
			onSelect={onPick}
			className="items-start"
		>
			<span
				className={cn(
					"mt-0.5 grid size-7 shrink-0 place-items-center rounded-md",
					FAMILY_TILE[entry.family],
				)}
			>
				<Icon aria-hidden="true" />
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="font-medium">{entry.label}</span>
				{blurb ? (
					<span className="text-muted-foreground text-xs">{blurb}</span>
				) : null}
			</span>
			{entry.badge ? (
				<Badge
					variant="outline"
					className="mt-0.5 max-w-32"
					title={entry.badge}
				>
					<span className="truncate">{entry.badge}</span>
				</Badge>
			) : null}
			{reads ? (
				<CommandShortcut
					className="mt-0.5 max-w-40 truncate font-mono tracking-normal"
					title={`Reads ${reads}`}
				>
					{reads}
				</CommandShortcut>
			) : null}
		</CommandItem>
	);
}
