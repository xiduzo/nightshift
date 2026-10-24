import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Separator } from "@nightshift/ui/components/separator";
import { Spinner } from "@nightshift/ui/components/spinner";
import { cn } from "@nightshift/ui/lib/utils";
import { EllipsisIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The detail pane of a list-and-detail page (Agents, Devices): a header,
 * settings-style sections (what it is on the left, the fields on the
 * right), and a save bar that shows only while there are unsaved changes.
 * The pane scrolls on its own; the list beside it stays put.
 */
export function DetailShell({
	icon,
	kicker,
	title,
	mono = false,
	subtitle,
	actions,
	save,
	children,
}: {
	icon: ReactNode;
	kicker: ReactNode;
	title: string;
	/** A name a flow refers to: shown as code. */
	mono?: boolean;
	subtitle?: ReactNode;
	/** The ⋯ menu: Delete and the like. */
	actions?: { label: string; destructive?: boolean; onSelect: () => void }[];
	save?: {
		isNew: boolean;
		dirty: boolean;
		canSave: boolean;
		pending: boolean;
		onSave: () => void;
		onDiscard: () => void;
	};
	children: ReactNode;
}) {
	const showBar = save && (save.dirty || save.isNew);
	return (
		<div className="flex min-h-full flex-col">
			<div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pt-8 pb-16 md:px-8">
				<header className="flex items-start gap-4">
					<div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-muted [&_svg]:size-5">
						{icon}
					</div>
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<p className="text-muted-foreground text-xs">{kicker}</p>
						<h1
							className={cn(
								"truncate font-semibold text-2xl tracking-tight",
								mono && "font-mono",
							)}
						>
							{title}
						</h1>
						{subtitle ? (
							<div className="text-muted-foreground text-sm">{subtitle}</div>
						) : null}
					</div>
					{actions && actions.length > 0 ? (
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button variant="ghost" size="icon-sm" aria-label="More" />
								}
							>
								<EllipsisIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{actions.map((action) => (
									<DropdownMenuItem
										key={action.label}
										variant={action.destructive ? "destructive" : "default"}
										onClick={action.onSelect}
									>
										{action.label}
									</DropdownMenuItem>
								))}
							</DropdownMenuContent>
						</DropdownMenu>
					) : null}
				</header>
				{children}
			</div>
			{showBar ? (
				<div className="sticky bottom-0 border-t bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80">
					<div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-2 px-4 py-3 md:px-8">
						<span className="mr-auto text-muted-foreground text-sm">
							{save.isNew ? "Not saved yet" : "Unsaved changes"}
						</span>
						<Button
							variant="ghost"
							size="sm"
							disabled={save.pending}
							onClick={save.onDiscard}
						>
							{save.isNew ? "Cancel" : "Discard"}
						</Button>
						<Button
							size="sm"
							disabled={!save.canSave || save.pending}
							onClick={save.onSave}
						>
							{save.pending ? <Spinner data-icon="inline-start" /> : null}
							{save.isNew ? "Add" : "Save"}
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}

/** One group of a detail pane: its title and a line on the left, its fields on the right. */
export function DetailSection({
	title,
	description,
	children,
}: {
	title: string;
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<>
			<Separator />
			<section className="grid gap-4 md:grid-cols-[16rem_1fr] md:gap-12">
				<div className="flex flex-col gap-1">
					<h2 className="font-medium text-sm">{title}</h2>
					{description ? (
						<p className="text-muted-foreground text-xs">{description}</p>
					) : null}
				</div>
				<div className="min-w-0">{children}</div>
			</section>
		</>
	);
}
