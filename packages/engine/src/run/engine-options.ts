import type { Database } from "@nightshift/db";
import type { ProfileSettings } from "@nightshift/flows";
import type { DeviceDirectory } from "../contract";
import type { Device } from "../device";
import type { ProfileStore, RunSettings } from "../device-config";
import type { FlowDocuments } from "../flows";
import type { Git, SpaceDocuments } from "../projects";
import type { PeersFactory } from "./peers";
import type { MoveRows } from "./projects-move";

/** What `createEngine` takes: the database, this computer as a Device, and the hooks of the daemon. */
export type EngineOptions = {
	db: Database;
	/**
	 * This computer's Device id: the Walker of the runs this engine starts,
	 * and the Device whose Clones it works in. Default: the database's own
	 * Device (`directory.selfId()`).
	 */
	walkerId?: string;
	/**
	 * The Device rows the engine reads: this computer's Device and its
	 * owner, the names of Devices, and the Spaces a Host keeps.
	 * `@nightshift/devices` makes it (`deviceDirectory`).
	 */
	directory: DeviceDirectory;
	/**
	 * This computer as a Device (`localDevice`): its harnesses, decider,
	 * connections, CLI tools, commands and worktrees. A run's steps run on
	 * it unless the run is placed on another Device.
	 */
	device: Device;
	/**
	 * The other Devices and Hosts (`Peers`): where steps run, Offers, the
	 * Host that keeps a Space, and the runs walked elsewhere. The engine
	 * calls it once, with its own parts. `@nightshift/devices` makes it.
	 */
	peers: PeersFactory;
	/** Root for transcripts, command logs and other on-disk state, for example ~/.nightshift. */
	dataDir: string;
	/** How many runs may run a step at once. A run waiting at a Gate does not count. Default 2. */
	maxConcurrentRuns?: number;
	/** Safety net against runaway flows: the most steps one run may take, unless the flow's policy sets `maxSteps`. Default 500. */
	maxStepsPerRun?: number;
	/**
	 * The scheduler starts the runs of the projects' schedules when
	 * their cron times come due. On by default; `false` turns it off.
	 * Aborting `signal` stops it for good, for example when a hot reload
	 * replaces the engine.
	 */
	scheduler?: false | { signal?: AbortSignal };
	/**
	 * The daemon's settings, read each time one applies: the run cap, the
	 * step cap, the policy defaults and the scheduler switch. Overrides
	 * `maxConcurrentRuns` and `maxStepsPerRun` when set.
	 */
	settings?: () => RunSettings;
	/**
	 * A profile of this computer by its id. A run resolves the profiles its
	 * nodes name when it starts; a flow that names a profile of this
	 * computer that this returns null for refuses to start. Without it, no
	 * profile exists.
	 */
	profileFor?: (id: string) => ProfileSettings | null;
	/**
	 * The Space documents, where Projects are defined. The daemon passes
	 * the ones the relay serves. Default: new ones over `db` and `directory`.
	 */
	spaceDocuments?: SpaceDocuments;
	/**
	 * The flow documents: the flows and schedules of each Project (ADR 2).
	 * The daemon passes the ones the relay serves. Default: new ones over
	 * `db`.
	 */
	flowDocuments?: FlowDocuments;
	/**
	 * This Device's profiles, where the import on upgrade puts the profiles
	 * of a Clone's `.nightshift/profiles.json`. Without them, a Clone with
	 * project profiles keeps its folder.
	 */
	profiles?: Pick<ProfileStore, "list" | "save">;
	/**
	 * The git port, for a new project's clone and remote and the branches
	 * of a clone. Default: the git programs on this computer.
	 */
	git?: Git;
	/**
	 * A secret's value by name: the secret a webhook schedule names as
	 * `${NAME}`. The daemon passes its Secrets (the keychain, then the
	 * environment). Default: the environment.
	 */
	secret?: (name: string) => Promise<string | undefined>;
	/**
	 * The rows of the packages above the engine that move with the runs of
	 * a Space move (`Engine.moveProjects`), in its batch: the Commands of
	 * the moved runs (`@nightshift/devices`), the notifier's deliveries
	 * (`@nightshift/notifications`).
	 */
	moveRows?: readonly MoveRows[];
};
