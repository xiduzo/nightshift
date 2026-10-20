import type { Database } from "@nightshift/db";
import type { AgentProfileSettings } from "@nightshift/flows";
import type { Device, WorkRelay } from "../device";
import type { RunSettings } from "../device-config";
import type { DeviceOffer } from "../peers";
import type { SpaceDocuments } from "../projects";
import type { Relay } from "./relay";

/** What `createEngine` takes: the database, this computer as a Device, and the hooks of the daemon. */
export type EngineOptions = {
	db: Database;
	/** The Hosts, for the actions on rows another Device owns. */
	relay?: Relay;
	/**
	 * This computer's Device id (`selfDevice`): the Walker of the runs this
	 * engine starts, and the Device whose Clones it works in. Default: the
	 * database's own Device.
	 */
	walkerId?: string;
	/**
	 * This computer as a Device (`localDevice`): its harnesses, decider,
	 * connections, CLI tools, commands and worktrees. A run's steps run on
	 * it unless the run is placed on another Device.
	 */
	device: Device;
	/**
	 * On a Host: how its runs reach the Devices they are placed on (the
	 * hub those Devices pull their work from). Without it, every run runs
	 * on this computer.
	 */
	work?: WorkRelay;
	/** Root for transcripts, command logs and other on-disk state, for example ~/.nightshift. */
	dataDir: string;
	/** How many runs may run a step at once. A run waiting at a Gate does not count. Default 2. */
	maxConcurrentRuns?: number;
	/** Safety net against runaway flows: the most steps one run may take, unless the flow's policy sets `maxSteps`. Default 500. */
	maxStepsPerRun?: number;
	/**
	 * The scheduler starts the runs of `.nightshift/schedules.json` when
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
	 * An Agent Profile by name. A run resolves the profiles its Agent nodes
	 * name when it starts; a flow that names a profile this returns null for
	 * refuses to start. Without it, no profile exists.
	 */
	profileFor?: (name: string) => AgentProfileSettings | null;
	/**
	 * This computer's own Offers (its Device document). A run of another
	 * Person placed here may use only those the Space also lists. Without
	 * it, this computer offers nothing.
	 */
	ownOffers?: () => readonly DeviceOffer[];
	/**
	 * Whether a Person's role in a Space lets them use Offers (`offer.use`),
	 * the Host's check before it places another Person's run through one.
	 * Without it, nobody uses Offers here.
	 */
	mayUseOffers?: (spaceId: string, personId: string) => Promise<boolean>;
	/**
	 * The Space documents, where Projects are defined. The daemon passes
	 * the ones the relay serves. Default: new ones over `db`.
	 */
	spaceDocuments?: SpaceDocuments;
};
