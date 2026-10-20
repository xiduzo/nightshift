/** The left side of the Agents page: the groups of profiles, harnesses, connections and tools. */
import { Button } from "@nightshift/ui/components/button";
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
import { LaptopIcon, PlusIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * One Device's profiles, harnesses, tools and secrets, under its name.
 * Today the only Device is this computer.
 */
export function DeviceSection({
	name,
	description,
	children,
}: {
	/** Undefined while it loads. */
	name: string | undefined;
	description: string;
	children: ReactNode;
}) {
	return (
		<section aria-label={name ?? description} className="flex flex-col gap-5">
			<Item size="sm" variant="muted">
				<ItemMedia variant="icon">
					<LaptopIcon />
				</ItemMedia>
				<ItemContent className="min-w-0">
					{name === undefined ? (
						<Skeleton className="h-4 w-32" />
					) : (
						<ItemTitle className="max-w-full truncate">{name}</ItemTitle>
					)}
					<ItemDescription className="text-xs">{description}</ItemDescription>
				</ItemContent>
			</Item>
			{children}
		</section>
	);
}

export function Group({
	title,
	hint,
	addLabel,
	onAdd,
	children,
}: {
	title: string;
	hint: string;
	addLabel: string;
	onAdd: () => void;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1">
			<div className="flex items-center justify-between px-2">
				<div>
					<h2 className="font-medium text-sm">{title}</h2>
					<p className="text-muted-foreground text-xs">{hint}</p>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={addLabel}
					title={addLabel}
					onClick={onAdd}
				>
					<PlusIcon />
				</Button>
			</div>
			<ItemGroup className="gap-0.5">{children}</ItemGroup>
		</section>
	);
}

export function ListItem({
	selected,
	onClick,
	icon,
	title,
	description,
	aside,
}: {
	selected: boolean;
	onClick: () => void;
	icon: ReactNode;
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
			<ItemMedia variant="icon">{icon}</ItemMedia>
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
