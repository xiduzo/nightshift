import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@nightshift/ui/components/breadcrumb";
import { Button } from "@nightshift/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import { Separator } from "@nightshift/ui/components/separator";
import { SidebarTrigger } from "@nightshift/ui/components/sidebar";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronDownIcon, type LucideIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";

/** One step of the breadcrumb. The last one is the current page and takes no link. */
export type Crumb = {
	label: ReactNode;
	link?: Pick<LinkProps, "to" | "params" | "search">;
	/** On the current page: the pages beside it, to go to from here. */
	menu?: CrumbMenuItem[];
};

/** One page in the menu of a breadcrumb step. */
export type CrumbMenuItem = {
	label: string;
	icon: LucideIcon;
	link: Pick<LinkProps, "to" | "params" | "search">;
	/** This is the page you are on. */
	current: boolean;
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
									<BreadcrumbSeparator className="hidden shrink-0 md:block" />
								) : null}
								<BreadcrumbItem
									className={
										last
											? "min-w-0"
											: "hidden shrink-0 whitespace-nowrap md:inline-flex"
									}
								>
									{last && crumb.menu ? (
										<CrumbMenu label={crumb.label} items={crumb.menu} />
									) : last || !crumb.link ? (
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

/** The current step of the breadcrumb as a menu, after the shadcn Breadcrumb "with dropdown". */
function CrumbMenu({
	label,
	items,
}: {
	label: ReactNode;
	items: CrumbMenuItem[];
}) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						variant="ghost"
						size="sm"
						aria-current="page"
						className="-mx-2 font-normal text-foreground"
					/>
				}
			>
				{label}
				<ChevronDownIcon data-icon="inline-end" />
				<span className="sr-only">Choose another page</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				{items.map(({ label: name, icon: Icon, link, current }) => (
					<DropdownMenuItem
						key={name}
						disabled={current}
						render={<Link {...link} />}
					>
						<Icon aria-hidden="true" />
						{name}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
