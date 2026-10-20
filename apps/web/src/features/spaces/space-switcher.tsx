import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@nightshift/ui/components/sidebar";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	ChevronsUpDownIcon,
	PlusIcon,
	UserIcon,
	UsersIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/shared/page";
import { CreateSpaceDialog } from "./create-space-dialog";
import { spaceMutations, spaceQueries } from "./queries";

/** The personal Space always reads "Personal", whatever it is called. */
const spaceName = (space: { name: string; personal: boolean }) =>
	space.personal ? "Personal" : space.name;

/**
 * The Space switcher, after the team switcher of the shadcn `sidebar-07`
 * block: the Space you work in, and the others you are a member of, the
 * personal one first. Switching shows that Space's projects, runs and Gates.
 * "Create Space" makes a new one, with you as its owner.
 */
export function SpaceSwitcher() {
	const { isMobile } = useSidebar();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [creating, setCreating] = useState(false);
	const spaces = useQuery(spaceQueries.list());
	const active = spaces.data?.spaces.find(
		(space) => space.id === spaces.data?.active,
	);
	const switchSpace = useMutation(
		spaceMutations.switch({
			onSuccess: async () => {
				// Every page shows the new Space: its projects, runs and Gates.
				await navigate({ to: "/" });
				await queryClient.invalidateQueries();
			},
			onError: (error) => {
				toast.error(`Could not switch the Space. ${error.message}`);
			},
		}),
	);

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								size="lg"
								tooltip="Switch Space"
								className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
							/>
						}
					>
						{/* `!` beats the menu button's `[&_svg]:size-4`. */}
						<Logo className="size-8!" />
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-semibold">
								{active ? spaceName(active) : "Night Shift"}
							</span>
							<span className="truncate text-muted-foreground text-xs">
								Night Shift
							</span>
						</div>
						<ChevronsUpDownIcon className="ml-auto" aria-hidden="true" />
					</DropdownMenuTrigger>
					<DropdownMenuContent
						className="min-w-56"
						align="start"
						side={isMobile ? "bottom" : "right"}
					>
						<DropdownMenuGroup>
							<DropdownMenuLabel>Spaces</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={spaces.data?.active ?? ""}
								onValueChange={(spaceId: string) => {
									if (spaceId !== spaces.data?.active) {
										switchSpace.mutate({ spaceId });
									}
								}}
							>
								{spaces.data?.spaces.map((space) => {
									const Icon = space.personal ? UserIcon : UsersIcon;
									return (
										<DropdownMenuRadioItem
											key={space.id}
											value={space.id}
											className="gap-2 p-2"
										>
											<span className="flex size-6 items-center justify-center rounded-md border">
												<Icon
													className="size-3.5 shrink-0"
													aria-hidden="true"
												/>
											</span>
											{spaceName(space)}
										</DropdownMenuRadioItem>
									);
								})}
							</DropdownMenuRadioGroup>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="gap-2 p-2"
							onClick={() => setCreating(true)}
						>
							<span className="flex size-6 items-center justify-center rounded-md border bg-transparent">
								<PlusIcon className="size-3.5" aria-hidden="true" />
							</span>
							<span className="font-medium text-muted-foreground">
								Create Space
							</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<CreateSpaceDialog open={creating} onOpenChange={setCreating} />
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
