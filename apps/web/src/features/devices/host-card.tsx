import { platformName } from "@nightshift/client";
import {
	Alert,
	AlertAction,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui/components/card";
import { cn } from "@nightshift/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
	CircleAlertIcon,
	CloudOffIcon,
	HouseIcon,
	LinkIcon,
	ServerIcon,
	SmartphoneIcon,
} from "lucide-react";
import type { Phone } from "@/shared/api";
import { formatRelative } from "@/shared/format";
import type { SpaceHost } from "./space-view";
import { HostStatus, ONLINE } from "./status-badges";

/**
 * The Host that keeps the Space, on top of the Devices page, with your
 * phones on it. When this computer cannot reach it, the card says so and
 * leads to the connection settings.
 */
export function HostCard({
	host,
	phones,
	phonesError,
	now,
	onPhone,
}: {
	host: SpaceHost;
	/** Undefined while they load. */
	phones: Phone[] | undefined;
	phonesError: boolean;
	now: number;
	/** Opens "Get Night Shift on your phone". */
	onPhone: () => void;
}) {
	const linked = host.kind === "linked" ? host.host : null;
	const offline = linked?.status === "offline";
	const name =
		host.kind === "linked"
			? host.host.name
			: (host.computer?.name ?? "This Host");
	const Icon = offline
		? CloudOffIcon
		: !linked
			? ServerIcon
			: linked.role === "home"
				? HouseIcon
				: LinkIcon;

	return (
		<Card className={cn(offline && "border-destructive/40")}>
			<CardHeader>
				<div className="flex min-w-0 items-center gap-3">
					<div
						className={cn(
							"flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted [&_svg]:size-5",
							offline && "bg-destructive/10 text-destructive",
						)}
					>
						<Icon />
					</div>
					<div className="flex min-w-0 flex-col gap-0.5">
						<CardTitle className="flex items-center gap-2">
							<span className="truncate">{name}</span>
							{linked ? (
								<HostStatus status={linked.status} />
							) : (
								<Badge variant="outline" className={ONLINE}>
									Online
								</Badge>
							)}
						</CardTitle>
						<CardDescription className="truncate">
							{linked
								? linked.role === "home"
									? "Host · Your home Host"
									: "Host · A guest Host"
								: "Host · This computer"}
							{linked?.address ? (
								<>
									{" · "}
									<code className="text-xs">{linked.address}</code>
								</>
							) : null}
						</CardDescription>
					</div>
				</div>
				<CardAction>
					<Button
						variant="outline"
						size="sm"
						nativeButton={false}
						render={
							<Link
								to="/devices"
								search={(prev) => ({ ...prev, device: "host" })}
							/>
						}
					>
						Open
					</Button>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{offline && linked ? (
					<Alert variant="destructive">
						<CircleAlertIcon />
						<AlertTitle>This computer cannot reach {linked.name}</AlertTitle>
						<AlertDescription>
							Not connected since {formatRelative(linked.since, now)}. Night
							Shift keeps trying, and syncs again once it answers.
						</AlertDescription>
						<AlertAction>
							<Button
								variant="outline"
								size="sm"
								nativeButton={false}
								render={<Link to="/settings" hash="this-computer" />}
							>
								Check the connection
							</Button>
						</AlertAction>
					</Alert>
				) : null}
				<div className="flex flex-col gap-2">
					<p className="text-muted-foreground text-xs">Your phones on it</p>
					<div className="flex flex-wrap items-center gap-2">
						{(phones ?? []).map((phone) => (
							<Button
								key={phone.id}
								variant="secondary"
								size="sm"
								nativeButton={false}
								render={
									<Link
										to="/devices"
										search={(prev) => ({
											...prev,
											device: `phone:${phone.id}`,
										})}
									/>
								}
							>
								<SmartphoneIcon data-icon="inline-start" />
								{phone.name}
								<span className="text-muted-foreground">
									{phone.lastSeenAt
										? formatRelative(phone.lastSeenAt, now)
										: platformName(phone.platform)}
								</span>
							</Button>
						))}
						{phones === undefined ? (
							<span className="text-muted-foreground text-sm">
								{phonesError ? `${name} does not answer now.` : "Loading."}
							</span>
						) : phones.length === 0 ? (
							<span className="text-muted-foreground text-sm">
								No phone yet.{" "}
								<Button
									variant="link"
									size="sm"
									className="h-auto p-0"
									onClick={onPhone}
								>
									Show me how
								</Button>
							</span>
						) : null}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
