import { NODE_FAMILIES, NODE_FAMILY_LABEL } from "@nightshift/flows";
import { Button } from "@nightshift/ui/components/button";
import { Kbd } from "@nightshift/ui/components/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@nightshift/ui/components/tooltip";
import { cn } from "@nightshift/ui/lib/utils";
import { PlusIcon } from "lucide-react";
import {
	FAMILY_TILE,
	type PaletteItem,
	paletteMeta,
} from "../canvas/node-type";
import { PALETTE, paletteFamily } from "./add-node/catalog";

/** The drag data of a palette item on its way from the dock to the canvas. */
export const NODE_DRAG_TYPE = "application/x-nightshift-node";

export function isPaletteItem(value: string): value is PaletteItem {
	return (PALETTE as readonly string[]).includes(value);
}

/** The palette by family, for the dock's groups. */
const FAMILY_ITEMS = NODE_FAMILIES.map((family) => ({
	family,
	items: PALETTE.filter((item) => paletteFamily(item) === family),
})).filter((group) => group.items.length > 0);

/**
 * One dock item, after the Magic UI Dock, in CSS only: the item you point at
 * grows most, its neighbours a little, the next ones a touch. The dock keeps
 * its width, so the bigger icons reach out over the canvas.
 */
const DOCK_ITEM = cn(
	"size-8 shrink-0 rounded-full bg-background p-0 dark:bg-background",
	"transition-[width,height] duration-200 ease-out motion-reduce:transition-none",
	"hover:size-12",
	"[&:has(+_*:hover)]:size-10 [*:hover+&]:size-10",
	"[&:has(+*+*:hover)]:size-9 [*:hover+*+&]:size-9",
);

/**
 * The node types, as a dock on the left edge of the canvas, by family and
 * in its tint. The first button opens the add-node dialog: the way in by
 * keyboard. Drag a node onto the canvas to place it, or click it to add it
 * in the middle.
 */
export function NodeDock({
	onAdd,
	onSearch,
	onDragChange,
	className,
}: {
	onAdd: (type: PaletteItem) => void;
	/** Opens the add-node dialog. */
	onSearch: () => void;
	/** The item being dragged, and null when the drag ends. */
	onDragChange: (type: PaletteItem | null) => void;
	className?: string;
}) {
	return (
		<div
			role="toolbar"
			aria-label="Nodes"
			aria-orientation="vertical"
			className={cn(
				"flex w-11 flex-col items-start gap-3 rounded-xl border bg-background/80 p-1.5 shadow-sm backdrop-blur-md",
				className,
			)}
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="outline"
							onClick={onSearch}
							className={DOCK_ITEM}
							aria-label="Add a node"
						/>
					}
				>
					<PlusIcon className="size-[50%]" aria-hidden="true" />
				</TooltipTrigger>
				<TooltipContent side="right">
					Add a node <Kbd>Tab</Kbd>
				</TooltipContent>
			</Tooltip>
			{FAMILY_ITEMS.map(({ family, items }) => (
				<fieldset
					key={family}
					aria-label={NODE_FAMILY_LABEL[family]}
					className="flex flex-col items-start gap-1"
				>
					{items.map((type) => {
						const { label, icon: Icon, blurb } = paletteMeta(type);
						return (
							<Tooltip key={type}>
								<TooltipTrigger
									render={
										<Button
											variant="outline"
											draggable
											onDragStart={(event) => {
												event.dataTransfer.setData(NODE_DRAG_TYPE, type);
												event.dataTransfer.effectAllowed = "move";
												onDragChange(type);
											}}
											onDragEnd={() => onDragChange(null)}
											onClick={() => onAdd(type)}
											className={cn(
												DOCK_ITEM,
												"cursor-grab active:cursor-grabbing",
												FAMILY_TILE[family],
											)}
											aria-label={label}
										/>
									}
								>
									<Icon className="size-[50%]" aria-hidden="true" />
								</TooltipTrigger>
								<TooltipContent side="right" className="max-w-60">
									<span className="flex flex-col gap-0.5">
										<span className="font-medium">{label}</span>
										<span className="opacity-80">{blurb}</span>
									</span>
								</TooltipContent>
							</Tooltip>
						);
					})}
				</fieldset>
			))}
		</div>
	);
}
