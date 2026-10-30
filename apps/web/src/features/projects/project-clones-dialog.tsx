import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@nightshift/ui/components/dialog";
import {
	Item,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle,
} from "@nightshift/ui/components/item";
import { LaptopIcon, MonitorIcon } from "lucide-react";
import type { Project } from "@/shared/api";
import { CopyProjectHere } from "./copy-project-here";

/**
 * The computers that have the project's repository (its Clones), this one
 * first. Where another computer keeps it is that computer's own. Without
 * a Clone here: how its copy from GitHub goes.
 */
export function ProjectClonesDialog({
	project,
	onOpenChange,
}: {
	/** Open while set. */
	project: Project | null;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog open={project !== null} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Computers</DialogTitle>
					<DialogDescription>
						The computers that have a copy of {project?.name ?? "this project"}.
					</DialogDescription>
				</DialogHeader>
				{project ? (
					<div className="flex flex-col gap-2">
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
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	);
}
