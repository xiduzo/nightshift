import { Button } from "@nightshift/ui/components/button";
import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { Skeleton } from "@nightshift/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SmartphoneIcon } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

import { deviceQueries } from "@/features/devices";
import { SERVER_URL } from "@/shared/api";
import { PageSection } from "@/shared/page";

/** A phone reaches a Host only at an https:// address. */
function isHttps(address: string): boolean {
	return address.startsWith("https://");
}

/**
 * The Host address a phone signs in to: the address of this page when it
 * is https://, else the first https:// address of this computer as a Host.
 * Null when there is none.
 */
function phoneAddress(
	host: { enabled: boolean; addresses: string[] } | undefined,
): string | null {
	if (isHttps(SERVER_URL)) return new URL(SERVER_URL).origin;
	if (!host?.enabled) return null;
	const address = host.addresses.find(isHttps);
	return address ? new URL(address).origin : null;
}

/**
 * A QR code of this Host's address, for the Night Shift app on a phone.
 * The code holds the address only: no sign-in, no key. The person signs in
 * on the phone.
 */
export function PhoneCard() {
	const overview = useQuery({
		...deviceQueries.overview(),
		enabled: !isHttps(SERVER_URL),
	});
	const loading = !isHttps(SERVER_URL) && overview.isPending;
	const address = phoneAddress(overview.data?.thisComputer?.host);

	return (
		<PageSection
			title="Use Night Shift on your phone"
			description="Answer Gates and follow runs from your phone."
		>
			<Card>
				<CardContent>
					{loading ? (
						<Skeleton className="h-40 w-full" />
					) : address ? (
						<div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
							<div className="shrink-0 rounded-md bg-white p-3">
								<QRCodeSVG
									value={address}
									size={144}
									title="QR code of this Host's address"
								/>
							</div>
							<div className="flex min-w-0 flex-col gap-2 text-sm">
								<p>
									Scan this code with the Night Shift app on your phone. Then
									sign in with your email and password.
								</p>
								<p className="text-muted-foreground">
									The code holds this address only. You can also type it in the
									app:
								</p>
								<p className="break-all font-mono">{address}</p>
							</div>
						</div>
					) : (
						<Item size="sm" className="px-0">
							<ItemMedia variant="icon">
								<SmartphoneIcon aria-hidden="true" />
							</ItemMedia>
							<ItemContent className="min-w-0">
								<ItemTitle>Your phone needs an https:// address</ItemTitle>
								<ItemDescription className="line-clamp-none">
									Be a Host and add an https:// address on the Devices page.
									Then the code for your phone shows here.
								</ItemDescription>
							</ItemContent>
							<ItemActions>
								<Button
									variant="outline"
									size="sm"
									nativeButton={false}
									render={<Link to="/devices" />}
								>
									Devices
								</Button>
							</ItemActions>
						</Item>
					)}
				</CardContent>
			</Card>
		</PageSection>
	);
}
