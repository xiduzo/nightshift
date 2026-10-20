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
	ItemGroup,
	ItemMedia,
	ItemSeparator,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { Spinner } from "@nightshift/ui/components/spinner";
import { Switch } from "@nightshift/ui/components/switch";
import { Textarea } from "@nightshift/ui/components/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
	CopyIcon,
	FolderIcon,
	GlobeIcon,
	KeyRoundIcon,
	LaptopIcon,
	LockIcon,
	PlugIcon,
	RotateCwIcon,
	ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import type { ThisComputer } from "@/shared/api";
import { orpc } from "@/shared/api";
import { formatDateTime } from "@/shared/format";

import { platformName } from "./platform";

/**
 * This computer: its name, where its data is, whether Night Shift runs, and
 * "Be a Host" with the addresses other computers use. Its owner's only.
 */
export function ThisComputerCard({ computer }: { computer: ThisComputer }) {
	const settings = useQuery(orpc.settings.get.queryOptions());
	const daemon = settings.data?.daemon;
	const dataDir = daemon?.dataDir;
	const lease = daemon?.lease;

	return (
		<Card>
			<CardContent>
				<ItemGroup>
					<Item size="sm" className="px-0">
						<ItemMedia variant="icon">
							<LaptopIcon aria-hidden="true" />
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
							<ItemDescription
								className="truncate font-mono text-xs"
								title={dataDir}
							>
								{dataDir ?? <Skeleton className="h-4 w-64" />}
							</ItemDescription>
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
							<ItemDescription className="line-clamp-none">
								{lease ? (
									<>
										On {lease.host} since {formatDateTime(lease.since)}. Only
										one Night Shift at a time can use this data.
									</>
								) : (
									<Skeleton className="h-4 w-64" />
								)}
							</ItemDescription>
						</ItemContent>
					</Item>
					<ItemSeparator />
					<Item size="sm" className="px-0">
						<ItemMedia variant="icon">
							<PlugIcon aria-hidden="true" />
						</ItemMedia>
						<ItemContent>
							<ItemTitle>Coding agents</ItemTitle>
							<ItemDescription className="line-clamp-none">
								Check where your harnesses are installed, on the Agents page.
							</ItemDescription>
						</ItemContent>
						<ItemActions>
							<Button
								variant="outline"
								size="sm"
								nativeButton={false}
								render={<Link to="/agents" />}
							>
								Agents
							</Button>
						</ItemActions>
					</Item>
				</ItemGroup>
			</CardContent>
		</Card>
	);
}

/** "Be a Host", its addresses, and whom this computer answers. */
function HostSettings({ computer }: { computer: ThisComputer }) {
	const id = useId();
	const queryClient = useQueryClient();
	const { host } = computer;
	const saved = host.addresses.join("\n");
	const [draft, setDraft] = useState(saved);
	// A save, or an edit in another window, replaces the draft.
	useEffect(() => setDraft(saved), [saved]);

	const save = useMutation(
		orpc.settings.save.mutationOptions({
			onSuccess: (data) => {
				queryClient.setQueryData(orpc.settings.get.queryKey(), data);
				void queryClient.invalidateQueries({
					queryKey: orpc.devices.list.key(),
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
					<Field data-invalid={wrong ? true : undefined}>
						<FieldContent>
							<FieldLabel htmlFor={`${id}-addresses`}>Addresses</FieldLabel>
							<FieldDescription>
								One per line, in the order your devices try them. For example
								https://studio.local, then https://studio.example.com.
							</FieldDescription>
						</FieldContent>
						<Textarea
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
