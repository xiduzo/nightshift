import { cn } from "@nightshift/ui/lib/utils";
import { type ReactNode, useId } from "react";

/**
 * The title row of a page: the h1, one line on what the page is for, and the
 * page's actions on the right. Every page starts with it.
 */
export function PageHeading({
	title,
	description,
	actions,
	id,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	/** For an `aria-labelledby` around the page. */
	id?: string;
}) {
	return (
		<div className="flex items-end gap-4">
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<h1 id={id} className="truncate font-semibold text-2xl tracking-tight">
					{title}
				</h1>
				{description ? (
					<p className="text-muted-foreground text-sm">{description}</p>
				) : null}
			</div>
			{actions ? (
				<div className="flex shrink-0 items-center gap-2">{actions}</div>
			) : null}
		</div>
	);
}

/**
 * A titled part of a page. The h2 and its line sit above the content, never
 * inside a Card: a Card holds one thing (a flow, a project) or the content of
 * a section, not the section's title.
 */
export function PageSection({
	title,
	description,
	actions,
	className,
	children,
}: {
	title: ReactNode;
	description?: ReactNode;
	actions?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	const id = useId();
	return (
		<section
			aria-labelledby={id}
			className={cn("flex min-w-0 flex-col gap-4", className)}
		>
			<div className="flex items-end gap-4">
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<h2 id={id} className="font-semibold text-lg tracking-tight">
						{title}
					</h2>
					{description ? (
						<p className="text-muted-foreground text-sm">{description}</p>
					) : null}
				</div>
				{actions ? (
					<div className="flex shrink-0 items-center gap-2">{actions}</div>
				) : null}
			</div>
			{children}
		</section>
	);
}
