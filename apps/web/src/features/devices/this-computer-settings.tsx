import { platformName } from "@nightshift/client";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui/components/alert";
import { Badge } from "@nightshift/ui/components/badge";
import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@nightshift/ui/components/field";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemFooter,
	ItemGroup,
	ItemMedia,
	ItemSeparator,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CopyIcon,
	FolderIcon,
	GlobeIcon,
	HouseIcon,
	KeyRoundIcon,
	LinkIcon,
	LockIcon,
	RotateCwIcon,
	ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import {
	settingsMutations,
	settingsQueries,
} from "@/features/settings/queries";
import { spaceQueries } from "@/features/spaces";
import type { ThisComputer } from "@/shared/api";
import { formatDateTime } from "@/shared/format";
import { LargerTextarea } from "@/shared/larger-window";
import { PageSection } from "@/shared/page";
import { deviceIcon } from "./device-icon";
import { JoinHostDialog } from "./join-host-dialog";
import { LeaveHostButton } from "./leave-host";
import { OpenSpaceButton } from "./open-space";
import { deviceQueries } from "./queries";
import { HostStatus } from "./status-badges";

/**
 * This computer on the Settings page: what belongs to the computer and not
 * to a Space. Its name, "Be a Host" with the addresses other computers use,
 * the Hosts it joined with the Spaces each keeps, and where its data is.
 * Its owner's only: nothing for another Person.
 */
export function ThisComputerSettings() {
	const overview = useQuery(deviceQueries.overviewLive());
	const computer = overview.data?.thisComputer;
	if (overview.data && !computer) return null;
	// The Devices page links here.
	return (
		<PageSection
			className="scroll-mt-4"
			title={<span id="this-computer">This computer</span>}
			description="Whether other computers can pair with it, the Hosts it joined, and where it keeps its data."
		>
			{computer ? (
				<>
					<ThisComputerCard computer={computer} />
					<Hosts hosts={computer.hosts} />
				</>
			) : (
				<Skeleton className="h-64 w-full rounded-xl" />
			)}
		</PageSection>
	);
}

function ThisComputerCard({ computer }: { computer: ThisComputer }) {
	const settings = useQuery(settingsQueries.get());
	const daemon = settings.data?.daemon;
	const dataDir = daemon?.dataDir;
	const lease = daemon?.lease;
	const ComputerIcon = deviceIcon(computer);

	return (
		<Card>
			<CardContent>
				<ItemGroup>
					<Item size="sm" className="px-0">
						<ItemMedia variant="icon">
							<ComputerIcon aria-hidden="true" />
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle>{computer.name}</ItemTitle>
							<ItemDescription>
								{platformName(computer.platform)}
							</ItemDescription>
						</ItemContent>
						{lease ? (
							<ItemActions>
								<Badge variant="outline">Running</Badge>
							</ItemActions>
						) : null}
					</Item>
					<ItemSeparator />
					<HostSettings computer={computer} />
					<ItemSeparator />
					<Item size="sm" className="px-0">
						<ItemMedia variant="icon">
							<KeyRoundIcon aria-hidden="true" />
						</ItemMedia>
						<ItemContent>
							<ItemTitle>Secrets and access to your Hosts</ItemTitle>
							<ItemDescription className="line-clamp-none">
								{computer.keyStore === "keychain"
									? "Saved in the keychain of this computer."
									: "Saved in a file on this computer that only your account can read."}
							</ItemDescription>
						</ItemContent>
					</Item>
					<ItemSeparator />
					<Item size="sm" className="px-0">
						<ItemMedia variant="icon">
							<FolderIcon aria-hidden="true" />
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle>Data folder</ItemTitle>
							{dataDir ? (
								<ItemDescription
									className="truncate font-mono text-xs"
									title={dataDir}
								>
									{dataDir}
								</ItemDescription>
							) : (
								<Skeleton className="h-4 w-64" />
							)}
						</ItemContent>
						{dataDir ? (
							<ItemActions>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Copy the data folder path"
									onClick={() => {
										void navigator.clipboard
											.writeText(dataDir)
											.then(() => toast.success("Path copied"));
									}}
								>
									<CopyIcon />
								</Button>
							</ItemActions>
						) : null}
					</Item>
					<ItemSeparator />
					<Item size="sm" className="px-0">
						<ItemMedia variant="icon">
							<LockIcon aria-hidden="true" />
						</ItemMedia>
						<ItemContent>
							<ItemTitle>Status</ItemTitle>
							{lease ? (
								<ItemDescription className="line-clamp-none">
									On {lease.host} since {formatDateTime(lease.since)}. Only one
									Night Shift at a time can use this data.
								</ItemDescription>
							) : (
								<Skeleton className="h-4 w-64" />
							)}
						</ItemContent>
					</Item>
				</ItemGroup>
			</CardContent>
		</Card>
	);
}

/** "Be a Host", its addresses, "Copy every project", and whom this computer answers. */
function HostSettings({ computer }: { computer: ThisComputer }) {
	const id = useId();
	const queryClient = useQueryClient();
	const settings = useQuery(settingsQueries.get());
	const { host } = computer;
	const saved = host.addresses.join("\n");
	const [draft, setDraft] = useState(saved);
	// A save, or an edit in another window, replaces the draft.
	useEffect(() => setDraft(saved), [saved]);

	const save = useMutation(
		settingsMutations.save({
			onSuccess: (data) => {
				queryClient.setQueryData(settingsQueries.get().queryKey, data);
				void queryClient.invalidateQueries({
					queryKey: deviceQueries.overviewKey(),
				});
			},
			onError: (error) => toast.error(`Not saved: ${error.message}`),
		}),
	);

	const addresses = draft
		.split(/\s+/)
		.map((line) => line.trim())
		.filter(Boolean);
	const wrong = addresses.find((address) => !isHostAddress(address));
	const changed = addresses.join("\n") !== saved;

	return (
		<>
			<Item size="sm" className="px-0">
				<ItemMedia variant="icon">
					<GlobeIcon aria-hidden="true" />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>
						<label htmlFor={`${id}-host`}>Be a Host</label>
					</ItemTitle>
					<ItemDescription className="line-clamp-none">
						Your other computers can pair with this one and sync through it.
					</ItemDescription>
				</ItemContent>
				<ItemActions>
					<Switch
						id={`${id}-host`}
						checked={host.enabled}
						disabled={save.isPending}
						onCheckedChange={(checked) => save.mutate({ host: checked })}
					/>
				</ItemActions>
			</Item>
			{host.enabled ? (
				<div className="flex flex-col gap-4 pb-3 pl-12">
					<Field orientation="horizontal">
						<FieldContent>
							<FieldLabel htmlFor={`${id}-copy`}>Copy every project</FieldLabel>
							<FieldDescription>
								When someone adds a project from GitHub, this computer copies it
								too. Its schedules and chats can then use it here.
							</FieldDescription>
						</FieldContent>
						<Switch
							id={`${id}-copy`}
							checked={settings.data?.values.copyProjects ?? true}
							disabled={!settings.data || save.isPending}
							onCheckedChange={(checked) =>
								save.mutate({ copyProjects: checked })
							}
						/>
					</Field>
					<Field data-invalid={wrong ? true : undefined}>
						<FieldContent>
							<FieldLabel htmlFor={`${id}-addresses`}>Addresses</FieldLabel>
							<FieldDescription>
								One per line, in the order your devices try them. For example
								https://studio.local, then https://studio.example.com.
							</FieldDescription>
						</FieldContent>
						<LargerTextarea
							title="Addresses"
							id={`${id}-addresses`}
							className="font-mono text-xs"
							rows={3}
							value={draft}
							placeholder="https://studio.example.com"
							onChange={(event) => setDraft(event.target.value)}
						/>
						{wrong ? (
							<FieldError>
								Use https:// addresses. {wrong} is not one.
							</FieldError>
						) : null}
					</Field>
					<div className="flex items-center gap-3">
						<Button
							size="sm"
							variant="outline"
							disabled={!changed || Boolean(wrong) || save.isPending}
							onClick={() => save.mutate({ hostAddresses: addresses })}
						>
							{save.isPending ? <Spinner data-icon="inline-start" /> : null}
							Save addresses
						</Button>
						<span className="text-muted-foreground text-sm">
							{host.reachable === "network"
								? "Your other computers can connect now."
								: "Only this computer can connect now."}
						</span>
					</div>
					{host.restartNeeded ? (
						<Alert>
							<RotateCwIcon />
							<AlertTitle>Restart Night Shift to apply this</AlertTitle>
							<AlertDescription>
								{host.reachable === "network"
									? "After the restart, only this computer can connect."
									: "After the restart, your other computers can connect at these addresses."}
							</AlertDescription>
						</Alert>
					) : host.reachable === "this-computer" ? (
						<FieldDescription>
							Add an https:// address to let your other computers connect.
						</FieldDescription>
					) : null}
					{host.fingerprint ? (
						<Alert>
							<ShieldCheckIcon />
							<AlertTitle>Certificate fingerprint</AlertTitle>
							<AlertDescription>
								A device that pairs shows this fingerprint. Allow it only when
								the two match.
								<span className="mt-1 block break-all font-mono text-xs">
									{host.fingerprint}
								</span>
							</AlertDescription>
						</Alert>
					) : null}
				</div>
			) : null}
		</>
	);
}

/** An https:// address, or an http:// one on this computer. */
function isHostAddress(value: string): boolean {
	try {
		const url = new URL(value);
		if (url.protocol === "https:") return true;
		return (
			url.protocol === "http:" &&
			/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname)
		);
	} catch {
		return false;
	}
}

/** The Hosts this computer joined, each with the Spaces it keeps for it, and Join a Host. */
function Hosts({ hosts }: { hosts: ThisComputer["hosts"] }) {
	const [joining, setJoining] = useState(false);
	const activeSpace = useQuery(spaceQueries.list()).data?.active;
	const hasHome = hosts.some((host) => host.homeHost);
	return (
		<Card>
			<CardContent className="flex flex-col gap-3">
				<div className="flex items-end justify-between gap-4">
					<div className="flex flex-col gap-1">
						<h3 className="font-medium text-sm">Hosts it joined</h3>
						<p className="text-muted-foreground text-sm">
							{hosts.length === 0
								? "This computer keeps its own Spaces. Join a Host to work in a Space another computer keeps: yours, a server, or a colleague's."
								: "Each Space lives on one Host. Your home Host also keeps the settings of this computer."}
						</p>
					</div>
					<Button variant="outline" size="sm" onClick={() => setJoining(true)}>
						<LinkIcon data-icon="inline-start" />
						Join a Host
					</Button>
				</div>
				{hosts.length > 0 ? (
					<ItemGroup className="gap-2">
						{hosts.map((host) => (
							<Item key={host.hostId} variant="outline" size="sm">
								<ItemMedia variant="icon">
									{host.role === "home" ? (
										<HouseIcon aria-hidden="true" />
									) : (
										<LinkIcon aria-hidden="true" />
									)}
								</ItemMedia>
								<ItemContent className="min-w-0">
									<ItemTitle>
										{host.name}
										<Badge variant="secondary">
											{host.role === "home" ? "Home Host" : "Guest Host"}
										</Badge>
										<HostStatus status={host.status} />
									</ItemTitle>
									<ItemDescription className="line-clamp-none">
										{host.status === "revoked"
											? "The Host removed the access of this computer. Join it again to sync."
											: host.spaces.length > 0
												? "Open a Space to work in it. Each one is also in the Space switcher."
												: "Keeps no Space of yours yet."}
									</ItemDescription>
								</ItemContent>
								{host.homeHost ? (
									<ItemActions>
										<LeaveHostButton hostName={host.name} />
									</ItemActions>
								) : null}
								{host.status !== "revoked" && host.spaces.length > 0 ? (
									<ItemFooter>
										<ItemGroup className="w-full gap-1">
											{host.spaces.map((space) => (
												<Item key={space.id} variant="muted" size="xs">
													<ItemContent className="min-w-0">
														<ItemTitle className="max-w-full truncate">
															{space.name}
														</ItemTitle>
													</ItemContent>
													<ItemActions>
														{space.id === activeSpace ? (
															<Badge variant="secondary">Current</Badge>
														) : (
															<OpenSpaceButton spaceId={space.id} />
														)}
													</ItemActions>
												</Item>
											))}
										</ItemGroup>
									</ItemFooter>
								) : null}
							</Item>
						))}
					</ItemGroup>
				) : null}
			</CardContent>
			<JoinHostDialog
				open={joining}
				onOpenChange={setJoining}
				hasHome={hasHome}
			/>
		</Card>
	);
}
