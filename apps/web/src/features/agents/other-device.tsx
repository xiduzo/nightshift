/** The profiles and secret names of your other devices: read-only on this computer. */
import { Badge } from "@nightshift/ui/components/badge";
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
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { BotIcon, KeyRoundIcon, LaptopIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { OtherDevice } from "@/shared/api";
import { DetailSection, DetailShell } from "@/shared/detail";
import { formatRelative, useNow } from "@/shared/format";
import { PageSection } from "@/shared/page";

/** Where a person changes what another device has. */
function openOn(device: Pick<OtherDevice, "name">): string {
	return `To change its profiles and secrets, open Night Shift on ${device.name}.`;
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
					{device.checkedAt === null
						? openOn(device)
						: `Updated ${formatRelative(device.checkedAt, now)}. ${openOn(device)}`}
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
				description={`Only their names. The values stay on ${device.name}.`}
			>
				<SecretNames device={device} now={now} />
			</DetailSection>
		</DetailShell>
	);
}

/** The secret names of each of your other devices, under this computer's own secrets. */
export function OtherDevicesSecrets({ devices }: { devices: OtherDevice[] }) {
	const now = useNow(60_000);
	if (devices.length === 0) return null;
	return (
		<PageSection
			title="On your other devices"
			description="The names of the secrets saved there. The values stay on each device."
		>
			{devices.map((device) => (
				<Card key={device.id} className="py-0">
					<CardContent className="flex flex-col gap-3 p-4">
						<div className="flex flex-col gap-1">
							<h3 className="font-medium text-sm">{device.name}</h3>
							<p className="text-muted-foreground text-xs">{openOn(device)}</p>
						</div>
						<SecretNames device={device} now={now} />
					</CardContent>
				</Card>
			))}
		</PageSection>
	);
}

function SecretNames({ device, now }: { device: OtherDevice; now: number }) {
	if (device.secrets.length === 0) {
		return (
			<NothingYet
				icon={<KeyRoundIcon />}
				title="No secrets"
				description={`No secrets are saved on ${device.name}.`}
			/>
		);
	}
	return (
		<ItemGroup className="gap-2" aria-label={`Secrets on ${device.name}`}>
			{device.secrets.map((secret) => (
				<Item key={secret.name} variant="outline" size="sm">
					<ItemContent>
						<ItemTitle className="font-mono">{secret.name}</ItemTitle>
						{secret.setAt === null ? null : (
							<ItemDescription>
								Set {formatRelative(secret.setAt, now)}
							</ItemDescription>
						)}
					</ItemContent>
				</Item>
			))}
		</ItemGroup>
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
