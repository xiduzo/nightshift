import { mainOutputField, NODE_FAMILY_LABEL } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@nightshift/ui/components/input-group";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { SearchIcon } from "lucide-react";
import { type RefObject, useState } from "react";
import { FAMILY_TILE } from "../../canvas";
import { PresetForm } from "../inspector";
import { useProjectFolder } from "../project";
import {
	CATALOG,
	type CatalogEntry,
	catalogFamilies,
	NEEDS_FOLDER,
	offHere,
} from "./catalog";
import { dragEntry } from "./drag";
import type { NodeAdder } from "./use-node-adder";

/**
 * The node grid, inside the dock's popover: a search, then every node and
 * kit as a tile, one group per family, the kits after the nodes. Enter
 * picks the first match. A Value preset shows its form in place of the
 * tiles. Click a tile to add it, or drag it onto the canvas. In a project
 * without a folder, a kit or flow that needs one shows, but cannot be
 * picked.
 */
export function NodeGrid({
	adder,
	search,
	onDragChange,
	onDragging,
}: {
	adder: NodeAdder;
	/** The search field, which takes the focus as the grid opens. */
	search: RefObject<HTMLInputElement | null>;
	onDragChange: (entry: CatalogEntry | null) => void;
	/** A drag from the grid starts (true) or ends (false). */
	onDragging: (dragging: boolean) => void;
}) {
	const [query, setQuery] = useState("");
	const folder = useProjectFolder();
	const { from, preset } = adder;

	if (preset !== null) {
		return (
			<div className="grid gap-6 overflow-y-auto p-4">
				<PresetForm
					preset={preset}
					flow={adder.flow}
					replaces={false}
					from={from?.id}
					onUse={adder.applyPreset}
					onBack={adder.closePreset}
				/>
			</div>
		);
	}

	const families = catalogFamilies([...CATALOG, ...adder.myKits], query);
	const first = families
		.flatMap((family) => [...family.nodes, ...family.kits])
		.find((entry) => !offHere(entry, folder));
	const reads = from ? `${from.id}.${mainOutputField(from)}` : null;

	const tile = (entry: CatalogEntry) => (
		<GridTile
			key={entry.key}
			entry={entry}
			off={offHere(entry, folder)}
			// A node that takes a value reads the selected node.
			reads={
				entry.takes === "value" && entry.add.kind === "node" ? reads : null
			}
			marked={query !== "" && entry === first}
			onPick={() => adder.pick(entry)}
			drag={dragEntry(
				entry,
				(dragged) => {
					onDragChange(dragged);
					// Hidden a moment later: hiding the source at once ends the drag.
					if (dragged) setTimeout(() => onDragging(true), 0);
				},
				(dropped) => {
					onDragging(false);
					// A dropped preset keeps the grid open on its form.
					if (dropped && entry.add.kind !== "preset") adder.close();
				},
			)}
		/>
	);

	return (
		<>
			<div className="border-b p-2">
				<InputGroup>
					<InputGroupInput
						ref={search}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key !== "Enter" || !first) return;
							event.preventDefault();
							adder.pick(first);
						}}
						placeholder="Search nodes and kits"
						aria-label="Search nodes and kits"
					/>
					<InputGroupAddon>
						<SearchIcon />
					</InputGroupAddon>
				</InputGroup>
			</div>
			<div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-2">
				{families.map(({ family, nodes, kits }) => (
					<section
						key={family}
						aria-label={NODE_FAMILY_LABEL[family]}
						className="flex flex-col gap-1"
					>
						<h3 className="px-1 text-xs font-medium text-muted-foreground">
							{NODE_FAMILY_LABEL[family]}
						</h3>
						{nodes.length > 0 ? (
							<div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1">
								{nodes.map(tile)}
							</div>
						) : null}
						{kits.length > 0 ? (
							<>
								<h4 className="px-1 pt-1 text-[11px] text-muted-foreground">
									Kits
								</h4>
								<div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-1">
									{kits.map(tile)}
								</div>
							</>
						) : null}
					</section>
				))}
				{families.length === 0 ? (
					<p className="p-4 text-center text-sm text-muted-foreground">
						No node or kit matches. Try another word.
					</p>
				) : null}
			</div>
		</>
	);
}

/**
 * One node, preset, kit or flow: its icon on a tile in its family's tint,
 * and its name. The tooltip says what it does, what it reads, or why it
 * cannot be picked here. A flow of another project names its project.
 */
function GridTile({
	entry,
	off,
	reads,
	marked,
	onPick,
	drag,
}: {
	entry: CatalogEntry;
	off: boolean;
	reads: string | null;
	/** Enter picks it. */
	marked: boolean;
	onPick: () => void;
	drag: ReturnType<typeof dragEntry>;
}) {
	const Icon = entry.icon;
	const note = off ? NEEDS_FOLDER : entry.blurb;
	const from = entry.badge && entry.badge !== "Kit" ? entry.badge : null;
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						aria-disabled={off || undefined}
						onClick={off ? undefined : onPick}
						{...(off ? {} : drag)}
						className={cn(
							"h-auto flex-col gap-1 px-1 py-1.5 font-normal whitespace-normal",
							off ? "cursor-not-allowed opacity-50" : "cursor-grab",
							marked && "bg-muted ring-1 ring-ring",
						)}
					/>
				}
			>
				<span
					className={cn(
						"grid size-8 shrink-0 place-items-center rounded-md [&_svg]:size-4",
						FAMILY_TILE[entry.family],
					)}
				>
					<Icon aria-hidden="true" />
				</span>
				<span className="line-clamp-2 text-center text-[11px] leading-tight">
					{entry.label}
				</span>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="max-w-60">
				<span className="flex flex-col gap-0.5">
					<span className="font-medium">{entry.label}</span>
					{note ? <span className="opacity-80">{note}</span> : null}
					{from ? <span className="opacity-80">From {from}</span> : null}
					{reads ? (
						<span className="font-mono opacity-80">Reads {reads}</span>
					) : null}
				</span>
			</TooltipContent>
		</Tooltip>
	);
}
