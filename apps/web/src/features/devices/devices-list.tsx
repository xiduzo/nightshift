/** The list of the Devices page: the Space's Host, your computers in it, and the members' computers. */
import { platformName } from "@nightshift/client";
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
import { cn } from "@nightshift/ui/lib/utils";
import { PlusIcon } from "lucide-react";
import type { ReactNode } from "react";
import { PanelSection } from "@/shared/panel";
import type { SpaceComputer, SpaceHost } from "./space-view";

/** Which item of the list is open: the Host, or a computer by its id. */
export type DevicesSelection =
	| { kind: "host" }
	| { kind: "computer"; id: string };

/** One group of the list: a heading that folds it, its count, and an optional Add button. */
export function DevicesGroup({
	title,
	count,
	add,
	children,
}: {
	title: string;
	count: number;
	add?: { label: string; onClick: () => void };
	children: ReactNode;
}) {
	return (
		<PanelSection
			title={title}
			aside={
				<Badge variant="secondary" className="tabular-nums">
					{count}
				</Badge>
			}
			action={
				add ? (
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={add.label}
						title={add.label}
						onClick={add.onClick}
					>
						<PlusIcon />
					</Button>
				) : undefined
			}
			contentClassName="px-2 pb-3"
		>
			<ItemGroup className="gap-0.5">{children}</ItemGroup>
		</PanelSection>
	);
}

/** A green dot for online, grey for offline, an open ring when this computer cannot tell. */
export function OnlineDot({
	online,
	className,
}: {
	online: boolean | null;
	className?: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"inline-block size-2 shrink-0 rounded-full",
				online === true && "bg-status-finished",
				online === false && "bg-muted-foreground/40",
				online === null && "ring-1 ring-muted-foreground/40",
				className,
			)}
		/>
	);
}

export function HostListItem({
	host,
	selected,
	onClick,
}: {
	host: SpaceHost;
	selected: boolean;
	onClick: () => void;
}) {
	const { name, description, online } =
		host.kind === "linked"
			? {
					name: host.host.name,
					description:
						host.host.role === "home" ? "Your home Host" : "A guest Host",
					online:
						host.host.status === "online"
							? true
							: host.host.status === "connecting"
								? null
								: false,
				}
			: {
					name: host.computer?.name ?? "This Host",
					description: "This computer",
					online: true,
				};
	return (
		<ListItem
			selected={selected}
			onClick={onClick}
			title={name}
			description={description}
			aside={<OnlineDot online={online} />}
		/>
	);
}

export function ComputerListItem({
	computer,
	runningHere,
	selected,
	onClick,
}: {
	computer: SpaceComputer;
	/** Its runs on their way now. */
	runningHere: number;
	selected: boolean;
	onClick: () => void;
}) {
	const revoked = computer.paired?.revokedAt != null;
	const system = computer.platform ? platformName(computer.platform) : null;
	return (
		<ListItem
			selected={selected}
			onClick={onClick}
			title={
				<>
					<span className={cn("truncate", revoked && "text-muted-foreground")}>
						{computer.name}
					</span>
					{computer.thisDevice ? (
						<span className="font-normal text-muted-foreground">
							this computer
						</span>
					) : null}
				</>
			}
			description={[computer.mine ? null : computer.owner, system]
				.filter(Boolean)
				.join(" · ")}
			aside={
				<>
					{runningHere > 0 ? (
						<Badge variant="outline" className="tabular-nums">
							{runningHere} running
						</Badge>
					) : null}
					<OnlineDot online={revoked ? false : computer.online} />
				</>
			}
		/>
	);
}

function ListItem({
	selected,
	onClick,
	title,
	description,
	aside,
}: {
	selected: boolean;
	onClick: () => void;
	title: ReactNode;
	description: string;
	aside: ReactNode;
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
				<ItemTitle className="max-w-full">{title}</ItemTitle>
				{description ? (
					<ItemDescription className="truncate text-xs">
						{description}
					</ItemDescription>
				) : null}
			</ItemContent>
			<ItemActions>{aside}</ItemActions>
		</Item>
	);
}
