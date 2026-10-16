import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@nightshift/ui/components/breadcrumb";
import { Separator } from "@nightshift/ui/components/separator";
import { SidebarTrigger } from "@nightshift/ui/components/sidebar";
import { Link, type LinkProps } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

/** One step of the breadcrumb. The last one is the current page and takes no link. */
export type Crumb = {
	label: ReactNode;
	link?: Pick<LinkProps, "to" | "params" | "search">;
};

/**
 * The sticky bar on top of every page, as in the shadcn sidebar blocks: the
 * sidebar trigger, the breadcrumb, and the page's actions on the right.
 */
export function SiteHeader({
	crumbs,
	children,
}: {
	crumbs: Crumb[];
	/** Actions on the right, such as buttons. */
	children?: ReactNode;
}) {
	return (
		<header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-backdrop-filter:bg-background/60">
			<SidebarTrigger className="-ml-1" />
			<Separator
				orientation="vertical"
				className="mr-2 data-[orientation=vertical]:h-4"
			/>
			<Breadcrumb className="min-w-0 flex-1">
				<BreadcrumbList className="flex-nowrap">
					{crumbs.map((crumb, index) => {
						const last = index === crumbs.length - 1;
						return (
							<Fragment key={index}>
								{index > 0 ? (
									<BreadcrumbSeparator className="hidden md:block" />
								) : null}
								<BreadcrumbItem
									className={last ? "min-w-0" : "hidden md:inline-flex"}
								>
									{last || !crumb.link ? (
										<BreadcrumbPage className="truncate">
											{crumb.label}
										</BreadcrumbPage>
									) : (
										<BreadcrumbLink render={<Link {...crumb.link} />}>
											{crumb.label}
										</BreadcrumbLink>
									)}
								</BreadcrumbItem>
							</Fragment>
						);
					})}
				</BreadcrumbList>
			</Breadcrumb>
			{children ? (
				<div className="flex shrink-0 items-center gap-2">{children}</div>
			) : null}
		</header>
	);
}
