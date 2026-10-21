import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@nightshift/ui/components/alert-dialog";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@nightshift/ui/components/empty";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemSeparator,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	BellRingIcon,
	CircleAlertIcon,
	GlobeIcon,
	type LucideIcon,
	MonitorIcon,
	SmartphoneIcon,
	Trash2Icon,
} from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import type { NotificationScreen } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { currentSubscription, ownScreenId, setOwnScreenId } from "../browser";
import { notificationMutations, notificationQueries } from "../queries";

const ICONS: Record<NotificationScreen["kind"], LucideIcon> = {
	web: GlobeIcon,
	desktop: MonitorIcon,
	expo: SmartphoneIcon,
};

const KINDS: Record<NotificationScreen["kind"], string> = {
	web: "Browser",
	desktop: "Desktop app",
	expo: "Phone",
};

/** The phones, browsers and desktop apps that can notify you, each with Remove. */
export function ScreensCard() {
	const queryClient = useQueryClient();
	const screens = useQuery(notificationQueries.screens());
	const [toRemove, setToRemove] = useState<NotificationScreen | null>(null);
	const own = ownScreenId();
	const remove = useMutation(
		notificationMutations.removeScreen({
			onSuccess: (_result, { id }) => {
				setToRemove(null);
				if (id === own) {
					setOwnScreenId(null);
					void currentSubscription().then((subscription) =>
						subscription?.unsubscribe(),
					);
				}
				void queryClient.invalidateQueries({
					queryKey: notificationQueries.all(),
				});
				toast.success(
					toRemove?.kind === "expo"
						? `${toRemove.name} is removed and signed out`
						: `${toRemove?.name ?? "The screen"} is removed`,
				);
			},
			onError: (error) => toast.error(`Not removed: ${error.message}`),
		}),
	);

	return (
		<PageSection
			title="Phones and browsers that can notify you"
			description="Each one gets your notifications. Remove one you no longer use."
		>
			<Card className="py-0">
				<CardContent className="px-0">
					{screens.isLoading ? (
						<div className="flex flex-col gap-3 p-6">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-2/3" />
						</div>
					) : screens.error ? (
						<div className="p-4">
							<Alert variant="destructive">
								<CircleAlertIcon />
								<AlertTitle>The list did not load</AlertTitle>
								<AlertDescription>{screens.error.message}</AlertDescription>
							</Alert>
						</div>
					) : !screens.data || screens.data.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<BellRingIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>Nothing notifies you yet</EmptyTitle>
								<EmptyDescription>
									Turn on notifications in this browser above, or sign in with
									the Night Shift app on your phone.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<ItemGroup className="p-2">
							{screens.data.map((screen, index) => {
								const Icon = ICONS[screen.kind];
								return (
									<Fragment key={screen.id}>
										{index > 0 ? <ItemSeparator /> : null}
										<Item size="sm">
											<ItemMedia variant="icon">
												<Icon aria-hidden="true" />
											</ItemMedia>
											<ItemContent className="min-w-0">
												<ItemTitle className="min-w-0">
													<span className="truncate">{screen.name}</span>
													{screen.id === own ? (
														<Badge variant="secondary">This browser</Badge>
													) : null}
												</ItemTitle>
												<ItemDescription>
													{KINDS[screen.kind]}
													{screen.lastSeenAt
														? `, last used ${formatRelative(screen.lastSeenAt)}`
														: `, added ${formatRelative(screen.createdAt)}`}
												</ItemDescription>
											</ItemContent>
											<ItemActions>
												<Button
													variant="ghost"
													size="sm"
													aria-label={`Remove ${screen.name}`}
													onClick={() => setToRemove(screen)}
												>
													<Trash2Icon data-icon="inline-start" />
													Remove
												</Button>
											</ItemActions>
										</Item>
									</Fragment>
								);
							})}
						</ItemGroup>
					)}
				</CardContent>
				<AlertDialog
					open={toRemove !== null}
					onOpenChange={(open) => {
						if (!open) setToRemove(null);
					}}
				>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Remove {toRemove?.name}?</AlertDialogTitle>
							<AlertDialogDescription>
								{toRemove?.kind === "expo"
									? "The phone gets no more notifications and is signed out. Sign in on it again to use it."
									: "It gets no more notifications. Turn them on there again to get them back."}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								disabled={remove.isPending}
								onClick={() => {
									if (toRemove) remove.mutate({ id: toRemove.id });
								}}
							>
								{remove.isPending ? <Spinner data-icon="inline-start" /> : null}
								{remove.isPending
									? "Removing…"
									: toRemove?.kind === "expo"
										? "Remove and sign out"
										: "Remove"}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</Card>
		</PageSection>
	);
}
