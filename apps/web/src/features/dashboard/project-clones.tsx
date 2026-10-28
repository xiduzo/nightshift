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
import { CopyProjectHere } from "@/features/projects";
import type { Project } from "@/shared/api";
import { PageSection } from "@/shared/page";

/**
 * The computers that have the project's repository (its Clones), this one
 * first. Where another computer keeps it is that computer's own. Without
 * a Clone here: how its copy from GitHub goes.
 */
export function ProjectClones({ project }: { project: Project }) {
	return (
		<PageSection
			title="Clones"
			description="The computers that have this repository."
		>
			<Card size="sm">
				<CardContent className="flex flex-col gap-2">
					<CopyProjectHere project={project} />
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
