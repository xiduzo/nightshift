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
import { Link } from "@tanstack/react-router";
import { LaptopIcon } from "lucide-react";
import { PageSection } from "@/shared/page";

export function ThisComputerLink({ name }: { name: string | undefined }) {
	return (
		<PageSection
			title="This computer"
			description="Its name, where it keeps its data, and the computers it works with."
		>
			<Card>
				<CardContent>
					<Item size="sm" className="px-0">
						<ItemMedia variant="icon">
							<LaptopIcon aria-hidden="true" />
						</ItemMedia>
						<ItemContent className="min-w-0">
							<ItemTitle>{name ?? <Skeleton className="h-4 w-32" />}</ItemTitle>
							<ItemDescription className="line-clamp-none">
								Be a Host, pair your other computers, and see where your data
								is, on the Devices page.
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
				</CardContent>
			</Card>
		</PageSection>
	);
}
