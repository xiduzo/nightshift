/** The profiles and secret names of your other devices. Each moves a secret saved there when you ask. */
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@nightshift/ui/components/dropdown-menu";
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
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Spinner } from "@nightshift/ui/components/spinner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ArrowRightLeftIcon,
	BotIcon,
	FolderInputIcon,
	KeyRoundIcon,
	LaptopIcon,
	MoreHorizontalIcon,
	Trash2Icon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { OtherDevice } from "@/shared/api";
import { DetailSection, DetailShell } from "@/shared/detail";
import { formatRelative, useNow } from "@/shared/format";
import { PageSection } from "@/shared/page";
import { LocalTime } from "@/shared/time";
import {
	type MoveTarget,
	MoveToProjectDialog,
} from "./connections/move-to-project-dialog";
import { otherDeviceMutations, otherDeviceQueries } from "./queries";

/** Where a person changes the profiles of another device: there. */
function profilesOn(device: Pick<OtherDevice, "name">): string {
	return `To change its profiles, open Night Shift on ${device.name}.`;
}

/** One of your other devices: its profiles and the names of its secrets. */
export function OtherDeviceDetail({ device }: { device: OtherDevice }) {
	const now = useNow(60_000);
	return (
		<DetailShell
			icon={<LaptopIcon />}
			kicker="Your other device"
			title={device.name}
			subtitle={
				<>
					{device.online === null
						? null
						: device.online
							? "Online. "
							: "Offline. "}
					{device.checkedAt === null ? (
						profilesOn(device)
					) : (
						<>
							Updated{" "}
							<LocalTime at={device.checkedAt}>
								{formatRelative(device.checkedAt, now)}
							</LocalTime>
							. {profilesOn(device)}
						</>
					)}
				</>
			}
		>
			<DetailSection
				title="Profiles"
				description={`A flow can run a step with one of these profiles on ${device.name}.`}
			>
				{device.profiles.length === 0 ? (
					<NothingYet
						icon={<BotIcon />}
						title="No profiles"
						description={`${device.name} has no profiles yet.`}
					/>
				) : (
					<ItemGroup className="gap-2">
						{device.profiles.map((profile) => (
							<Item key={profile.id} variant="outline" size="sm">
								<ItemContent>
									<ItemTitle className="font-mono">{profile.name}</ItemTitle>
								</ItemContent>
								<Badge variant="secondary">
									{profile.kind === "agent" ? "Profile" : "Model profile"}
								</Badge>
							</Item>
						))}
					</ItemGroup>
				)}
			</DetailSection>
			<DetailSection
				title="Secrets"
				description={`Saved on ${device.name}. To use one on all your computers, move it to Personal.`}
			>
				<SecretNames device={device} now={now} />
			</DetailSection>
		</DetailShell>
	);
}

/** The secret names of each of your other devices, on the Secrets page of the Space. */
export function OtherDevicesSecrets({ devices }: { devices: OtherDevice[] }) {
	const now = useNow(60_000);
	if (devices.length === 0) return null;
	return (
		<PageSection
			title="On your other devices"
			description="The secrets saved on each device. To use one on your own computers, move it to Personal."
		>
			{devices.map((device) => (
				<Card key={device.id} className="py-0">
					<CardContent className="flex flex-col gap-3 p-4">
						<h3 className="font-medium text-sm">{device.name}</h3>
						<SecretNames device={device} now={now} />
					</CardContent>
				</Card>
			))}
		</PageSection>
	);
}

/**
 * The secrets saved on one of your other devices, each with a menu: that
 * device moves its own value to Personal or into a project, or removes it.
 * The value never passes through this computer.
 */
function SecretNames({ device, now }: { device: OtherDevice; now: number }) {
	const queryClient = useQueryClient();
	const [toProject, setToProject] = useState<MoveTarget | null>(null);
	const [removing, setRemoving] = useState<string | null>(null);
	/** The device no longer lists it: its copy here follows a moment later. */
	const forget = (name: string) =>
		queryClient.setQueryData(otherDeviceQueries.list().queryKey, (devices) =>
			devices?.map((d) =>
				d.id === device.id
					? { ...d, secrets: d.secrets.filter((s) => s.name !== name) }
					: d,
			),
		);
	const moveSecret = useMutation(
		otherDeviceMutations.moveSecret({
			onSuccess: (_, { name, to }) => {
				toast.success(
					to === "removed"
						? `Removed ${name} from ${device.name}`
						: `Moved ${name} to Personal`,
				);
				forget(name);
				setRemoving(null);
			},
			onError: (error, { to }) =>
				toast.error(
					`${to === "removed" ? "Not removed" : "Not moved"}: ${error.message}`,
				),
		}),
	);
	const busy = (name: string) =>
		moveSecret.isPending && moveSecret.variables?.name === name;

	if (device.secrets.length === 0) {
		return (
			<NothingYet
				icon={<KeyRoundIcon />}
				title="No secrets"
				description={`${device.name} has no secrets yet.`}
			/>
		);
	}
	return (
		<>
			<ItemGroup className="gap-2" aria-label={`Secrets on ${device.name}`}>
				{device.secrets.map((secret) => (
					<Item key={secret.name} variant="outline" size="sm">
						<ItemContent>
							<ItemTitle className="font-mono">{secret.name}</ItemTitle>
							{secret.setAt === null ? null : (
								<ItemDescription>
									Set{" "}
									<LocalTime at={secret.setAt}>
										{formatRelative(secret.setAt, now)}
									</LocalTime>
								</ItemDescription>
							)}
						</ItemContent>
						<ItemActions>
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											variant="ghost"
											size="icon-sm"
											aria-label={`More for ${secret.name}`}
											disabled={busy(secret.name)}
										/>
									}
								>
									{busy(secret.name) ? <Spinner /> : <MoreHorizontalIcon />}
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-56">
									<DropdownMenuItem
										onClick={() =>
											moveSecret.mutate({
												deviceId: device.id,
												name: secret.name,
												to: "personal",
											})
										}
									>
										<ArrowRightLeftIcon />
										Move to Personal
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() =>
											setToProject({
												name: secret.name,
												from: { deviceId: device.id, deviceName: device.name },
											})
										}
									>
										<FolderInputIcon />
										Move to a project…
									</DropdownMenuItem>
									<DropdownMenuSeparator />
									<DropdownMenuItem
										variant="destructive"
										onClick={() => setRemoving(secret.name)}
									>
										<Trash2Icon />
										Remove from {device.name}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</ItemActions>
					</Item>
				))}
			</ItemGroup>
			<MoveToProjectDialog
				target={toProject}
				onOpenChange={(open) => {
					if (!open) setToProject(null);
				}}
				onMoved={(target) => forget(target.name)}
			/>
			<AlertDialog
				open={removing !== null}
				onOpenChange={(open) => {
					if (!open) setRemoving(null);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Remove <span className="font-mono">{removing}</span> from{" "}
							{device.name}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							Steps on {device.name} that use it have no value until you set it
							again.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={moveSecret.isPending}
							onClick={() => {
								if (removing) {
									moveSecret.mutate({
										deviceId: device.id,
										name: removing,
										to: "removed",
									});
								}
							}}
						>
							{moveSecret.isPending ? (
								<Spinner data-icon="inline-start" />
							) : null}
							{moveSecret.isPending ? "Removing…" : "Remove"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function NothingYet({
	icon,
	title,
	description,
}: {
	icon: ReactNode;
	title: string;
	description: string;
}) {
	return (
		<Empty className="border p-6">
			<EmptyHeader>
				<EmptyMedia variant="icon">{icon}</EmptyMedia>
				<EmptyTitle>{title}</EmptyTitle>
				<EmptyDescription>{description}</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
