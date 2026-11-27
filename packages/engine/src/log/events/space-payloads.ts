import type {
	KnowledgeReadFrom,
	KnowledgeUseHit,
} from "@nightshift/agents/knowledge";

/**
 * The events of a Space that belong to no walk of a run: its projects and
 * Clones, its Devices, its Members and Offers, what cleanup removed, the
 * uses of a project's knowledge, and its schedules and webhooks.
 */

export type SpacePayloads = {
	ProjectAdded: {
		projectId: string;
		name: string;
		/** Absent: a Device asked its Host to add it, with a Clone only there. */
		repoPath?: string;
		/** The normalised `origin`, null without one. Absent before Clones. */
		remote?: string | null;
		/** False: a project without a folder (ADR 22). Absent: one with a folder. */
		folder?: false;
	};
	ProjectRemoved: { projectId: string };
	/** `addProject` on the path of a removed project. */
	ProjectRestored: { projectId: string };
	/**
	 * A folder became a Project's Clone on a Device: a folder whose `origin`
	 * names a Project already known, or a Clone that moved to a new folder.
	 */
	CloneAdded: { projectId: string; deviceId: string; path: string };
	/**
	 * On a Host: a Device paired with it. `ownerId` is the Person who
	 * approved the pairing; `home`: this Host keeps the Device's document.
	 * In the owner's personal Space.
	 */
	DeviceJoined: {
		deviceId: string;
		name: string;
		platform: string;
		ownerId: string;
		home: boolean;
	};
	/** On a Host: the owner removed the Device's access. Its key is gone. */
	DeviceRevoked: { deviceId: string };
	/** On a Host: the Device's link answered after a silence. */
	DeviceOnline: { deviceId: string };
	/** On a Host: the Device's link went silent, or its access was removed. */
	DeviceOffline: { deviceId: string };
	/**
	 * A Person became a Member of the Space with a role: they accepted an
	 * invitation (`invitedBy` sent it), made the Space, or were added. `by`
	 * is who did it; null when nobody signed in did.
	 */
	MemberJoined: {
		personId: string;
		role: string;
		by: string | null;
		invitedBy?: string;
	};
	/** A Person is no longer a Member of the Space. `by` removed them. */
	MemberRemoved: { personId: string; by: string | null };
	/** A Member got another role. `by` changed it. */
	MemberRoleChanged: {
		personId: string;
		role: string;
		previousRole: string;
		by: string | null;
	};
	/**
	 * A Device's owner offered one of its Agent Profiles to the Space, or
	 * changed the caps of that Offer. `by` made it.
	 */
	OfferMade: {
		deviceId: string;
		deviceName: string;
		/** The profile's id. */
		profile: string;
		/** The profile's name, where the event says it. */
		profileName?: string;
		permissionCap: string;
		sessionCap: number;
		by: string | null;
	};
	/** The Offer ended: its Device's owner withdrew it. Running steps under it end as stopped. */
	OfferWithdrawn: { deviceId: string; profile: string; by: string | null };
	/** A person gave the project a new name. */
	ProjectRenamed: { projectId: string; name: string };
	/** A person moved the project, with its Clones, runs and events, to another Space. */
	ProjectMoved: { projectId: string; from: string; to: string };
	/**
	 * Night Shift removed what a run left on this computer: its worktree
	 * (`worktreePath`, null when it stayed), local branches, or both. The
	 * work that was only here went to the kept refs in `kept` first
	 * (`refs/nightshift/kept/<short>/…`). `expired`: the kept refs it
	 * deleted once the run was `KEPT_WORK_DAYS` (30) old. `by: "cleanup"` is
	 * the scheduled cleanup, `person` a person's action (the Branches page,
	 * until 2026-11-12). A fact of this computer, not of the run: the event
	 * has no run, names the run in its payload, and the exchange does not
	 * copy it.
	 */
	WorktreeRemoved: {
		projectId: string;
		runId: string;
		worktreePath: string | null;
		branches: string[];
		kept?: string[];
		expired?: string[];
		by: "person" | "cleanup";
	};
	/**
	 * An agent searched the project's knowledge (`search_knowledge`), and
	 * the files it got back, best first, each at its best section. In an
	 * Agent step: on the step and its session (`via: "step"`). Through the
	 * nightshift MCP server (`via: "mcp"`): with no run. The Knowledge page
	 * (`knowledge/review/domain/use.ts`), the step's sources and the metrics read them.
	 */
	KnowledgeSearched: {
		projectId: string;
		query: string;
		hits: KnowledgeUseHit[];
		via: KnowledgeVia;
	};
	/** An agent read one file of the project's knowledge (`read_knowledge`). `found`: the file was there. */
	KnowledgeRead: {
		projectId: string;
		path: string;
		found: boolean;
		via: KnowledgeVia;
		/** The section, page or line the read started from. Absent: the start of the file. */
		from?: KnowledgeReadFrom;
	};
	/**
	 * A schedule came due and the scheduler started its run (`runId`), or
	 * tried to and could not (`error`). `at` is the cron time, not the
	 * moment of the tick: no cron time of a schedule fires twice. Logged
	 * without a run id on the row; the run is in the payload.
	 */
	ScheduleFired: {
		projectId: string;
		scheduleId: string;
		at: number;
		runId: string | null;
		error: string | null;
	};
	/**
	 * A cron time of a schedule that did not start: missed by more than the
	 * grace (the daemon was down or the computer slept), or an earlier run
	 * of the same schedule was still running, waiting or sleeping.
	 */
	ScheduleSkipped: {
		projectId: string;
		scheduleId: string;
		at: number;
		reason: string;
		/** The earlier run that still runs, when that is the reason. */
		runId: string | null;
	};
	/**
	 * A webhook arrived for a schedule and its secret checked out: the
	 * schedule took it (`accepted`: it started a run, sent its signal, or
	 * tried to), or its `when` did not hold or failed (`filtered`). A
	 * webhook that was refused (no secret, a wrong one) is never logged:
	 * anyone may send one. Logged without a run id on the row. `at` is when
	 * it arrived.
	 */
	WebhookReceived: {
		projectId: string;
		scheduleId: string;
		at: number;
		result: "accepted" | "filtered";
		/** The run it started. */
		runId: string | null;
		/** How many runs its signal woke. */
		woke: number;
		/** Why the run did not start, or why the rule or the key failed. */
		error: string | null;
	};
};

/** Where an agent used the knowledge: the tools of an Agent step, or the nightshift MCP server. */
export type KnowledgeVia = "step" | "mcp";
