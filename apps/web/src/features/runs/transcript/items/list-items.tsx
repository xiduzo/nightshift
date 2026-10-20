/** The items of a Call that runs once per item: the list it read, and each element's start and end. */
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemTitle,
} from "@nightshift/ui/components/item";
import {
	Marker,
	MarkerContent,
	MarkerIcon,
} from "@nightshift/ui/components/marker";
import { GitBranchIcon, ListChecksIcon } from "lucide-react";
import { ItemStateBadge } from "@/features/flows";
import { formatTime } from "@/shared/format";
import type { ItemEndItem, ItemStartItem, ItemsReadItem } from "../transcript";
import { Divider } from "./parts";

export function ItemsRead({ item }: { item: ItemsReadItem }) {
	return (
		<Marker className="text-xs">
			<MarkerIcon>
				<ListChecksIcon className="size-3.5" />
			</MarkerIcon>
			<MarkerContent>
				Read {item.count} {item.count === 1 ? "item" : "items"} · {item.open}{" "}
				open · {formatTime(item.at)}
			</MarkerContent>
		</Marker>
	);
}

export function ItemStart({ item }: { item: ItemStartItem }) {
	return (
		<div className="flex flex-col gap-1.5 pt-2">
			<Divider
				title={
					<>
						{item.title}
						{item.title !== item.itemId ? (
							<span className="ml-1.5 font-mono font-normal text-muted-foreground">
								{item.itemId}
							</span>
						) : null}
					</>
				}
				at={item.at}
				details={[formatTime(item.at)]}
			/>
			{item.branch ? (
				<p className="flex min-w-0 items-center justify-center gap-1 text-muted-foreground text-xs">
					<GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
					<span className="truncate font-mono text-foreground">
						{item.branch}
					</span>
					{item.baseBranch ? (
						<>
							<span aria-hidden="true">→</span>
							<span className="sr-only">on top of</span>
							<span className="truncate font-mono">{item.baseBranch}</span>
						</>
					) : null}
				</p>
			) : null}
		</div>
	);
}

export function ItemEnd({
	item,
	title,
}: {
	item: ItemEndItem;
	title?: string;
}) {
	return (
		<Item variant="outline" size="sm" className="bg-card">
			<ItemContent className="min-w-0">
				<ItemTitle className="w-full min-w-0 text-xs">
					<ItemStateBadge state={item.state} />
					<span className="min-w-0 truncate">
						{title && title !== item.itemId ? (
							<>
								{title}{" "}
								<span className="font-mono font-normal text-muted-foreground">
									{item.itemId}
								</span>
							</>
						) : (
							<span className="font-mono">{item.itemId}</span>
						)}
					</span>
				</ItemTitle>
				{item.reason ? (
					<ItemDescription className="line-clamp-none whitespace-pre-wrap break-words text-xs">
						{item.reason}
					</ItemDescription>
				) : null}
			</ItemContent>
			<ItemActions className="self-start text-muted-foreground text-xs tabular-nums">
				{formatTime(item.at)}
			</ItemActions>
		</Item>
	);
}
