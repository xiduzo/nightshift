import { Card, CardContent } from "@nightshift/ui/components/card";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { LaptopIcon, MonitorIcon } from "lucide-react";

import { PageSection } from "@/components/page-heading";
import type { Project } from "@/lib/api-types";

/**
 * The computers that have the project's repository (its Clones), this one
 * first. Where another computer keeps it is that computer's own.
 */
export function ProjectClones({ project }: { project: Project }) {
	return (
		<PageSection
			title="Clones"
			description="The computers that have this repository."
		>
			<Card size="sm">
				<CardContent>
					<ItemGroup className="gap-1">
						{project.clones.map((clone) => (
							<Item key={clone.deviceId} size="xs">
								<ItemMedia variant="icon">
									{clone.thisDevice ? <LaptopIcon /> : <MonitorIcon />}
								</ItemMedia>
								<ItemContent className="min-w-0">
									<ItemTitle className="w-full truncate">
										{clone.thisDevice
											? "This computer"
											: (clone.deviceName ?? "Another computer")}
									</ItemTitle>
									{clone.thisDevice && clone.deviceName ? (
										<ItemDescription className="truncate">
											{clone.deviceName}
										</ItemDescription>
									) : null}
								</ItemContent>
							</Item>
						))}
					</ItemGroup>
				</CardContent>
			</Card>
		</PageSection>
	);
}
