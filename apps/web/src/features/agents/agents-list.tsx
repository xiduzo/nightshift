/** The list of the Agents page: the groups of profiles, harnesses, connections and tools. */
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PanelSection } from "@/shared/panel";

/** One group of the list: a heading that folds it, its count, and an Add button. */
export function Group({
	title,
	count,
	addLabel,
	onAdd,
	children,
}: {
	title: string;
	/** Undefined while it loads. */
	count: number | undefined;
	addLabel: string;
	onAdd: () => void;
	children: ReactNode;
}) {
	return (
		<PanelSection
			title={title}
			aside={
				count === undefined ? null : (
					<Badge variant="secondary" className="tabular-nums">
						{count}
					</Badge>
				)
			}
			action={
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={addLabel}
					title={addLabel}
					onClick={onAdd}
				>
					<PlusIcon />
				</Button>
			}
			contentClassName="px-2 pb-3"
		>
			<ItemGroup className="gap-0.5">{children}</ItemGroup>
		</PanelSection>
	);
}

export function ListItem({
	selected,
	onClick,
	title,
	description,
	aside,
}: {
	selected: boolean;
	onClick: () => void;
	title: ReactNode;
	description?: string;
	aside?: ReactNode;
}) {
	return (
		<Item
			size="xs"
			variant={selected ? "muted" : "default"}
			render={
				<button
					type="button"
					className="text-left"
					aria-current={selected ? "page" : undefined}
				/>
			}
			onClick={onClick}
		>
			<ItemContent className="min-w-0">
				<ItemTitle className="max-w-full truncate">{title}</ItemTitle>
				{description ? (
					<ItemDescription className="truncate text-xs">
						{description}
					</ItemDescription>
				) : null}
			</ItemContent>
			{aside ? <ItemActions>{aside}</ItemActions> : null}
		</Item>
	);
}

export function ListSkeleton() {
	return (
		<div className="flex flex-col gap-2 px-2 py-1" aria-hidden>
			<Skeleton className="h-8 w-full" />
			<Skeleton className="h-8 w-full" />
		</div>
	);
}
