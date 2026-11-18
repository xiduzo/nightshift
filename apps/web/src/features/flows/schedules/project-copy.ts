import type { Machine } from "@/features/devices";

/**
 * Whether a computer has a copy of the project. True when this computer
 * cannot tell, and for a project without a folder: it needs no copy.
 */
export function hasProject(
	machine: Machine | null,
	projectId: string,
	withFolder: boolean,
): boolean {
	if (!withFolder) return true;
	return machine?.projectIds?.includes(projectId) ?? true;
}
