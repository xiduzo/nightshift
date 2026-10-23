import type { ApiOutputs } from "../api";

export type Project = ApiOutputs["projects"]["list"][number];
/** Whether a project's folder is ready to run flows. */
export type ProjectCheck = ApiOutputs["projects"]["check"];
/** The result of installing git on this computer. */
export type GitInstall = ApiOutputs["projects"]["installGit"];
/** A run's copy of the project and its branches on this computer. */
export type RunCopy = ApiOutputs["projects"]["runCopies"]["copies"][number];
