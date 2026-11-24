import type { Access } from "../../access";
import type {
	Keep,
	NewIds,
	ProjectDirectory,
	ProjectLog,
	Repos,
	SpaceHolds,
	ThisDevice,
} from "../keep";
import { addProject } from "./application/add-project";
import { addProjectWithoutFolder } from "./application/add-project-without-folder";
import { listBranches } from "./application/list-branches";
import { listProjects } from "./application/list-projects";
import type { HostRelay, ProjectRuns } from "./application/ports";
import { removeProject } from "./application/remove-project";
import { renameProject } from "./application/rename-project";
import { useProjectFolder } from "./application/use-project-folder";

/**
 * The wiring of a person's requests about the Projects: it binds each
 * use case to the shared ports (`keep`) and to the ports other verticals
 * fill. It builds no adapter of its own.
 */

/** What the engine gives the catalog. */
export type CatalogDeps = Keep & {
	access: Pick<Access, "openSpace">;
	projectLog: ProjectLog;
	thisDevice: ThisDevice;
	repos: Repos;
	directory: ProjectDirectory;
	spaceHolds: SpaceHolds;
	/** The relay to the Hosts, when this computer has one. */
	relay?: HostRelay;
	ids: NewIds;
	runs: ProjectRuns;
};

/** The use cases of the catalog, bound to their ports. */
export type Catalog = {
	/** The projects of the Space, with their Clones. */
	listProjects: ReturnType<typeof listProjects>;
	/** Adds a folder on this computer as a project of the Space. */
	addProject: ReturnType<typeof addProject>;
	/** Adds a project without a folder to the Space. */
	addProjectWithoutFolder: ReturnType<typeof addProjectWithoutFolder>;
	/** Makes a folder on this computer the folder of a project. */
	useProjectFolder: ReturnType<typeof useProjectFolder>;
	/** Gives a project a new name. */
	renameProject: ReturnType<typeof renameProject>;
	/** Removes a project from the Space. */
	removeProject: ReturnType<typeof removeProject>;
	/** The branches of a project's folder here. */
	listBranches: ReturnType<typeof listBranches>;
};

export function wireCatalog(deps: CatalogDeps): Catalog {
	return {
		listProjects: listProjects(deps),
		addProject: addProject(deps),
		addProjectWithoutFolder: addProjectWithoutFolder(deps),
		useProjectFolder: useProjectFolder(deps),
		renameProject: renameProject(deps),
		removeProject: removeProject(deps),
		listBranches: listBranches(deps),
	};
}
