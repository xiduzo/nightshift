import { type Auth, roleAllows, wireLogin, wireSpaces } from "@nightshift/auth";
import type { Database } from "@nightshift/db";
import { type Engine, NIGHT_SHIFT, type PersonActor } from "@nightshift/engine";
import { now as timeNow } from "@nightshift/time";
import {
	createVapidKeyStore,
	createWebPushChannel,
	type InAppChannel,
	type InAppItem,
	type PushChannels,
	type VapidKeys,
	type WatchOptions,
	type WebPushSender,
} from "./channels";
import {
	type ComputerSwitches,
	type NotificationSettings,
	type NotificationSettingsPatch,
	type PushTargetView,
	type RegisterTarget,
	type RunEventSource,
	wireNotifier,
	wireSettings,
	wireTargets,
} from "./notifications";

/**
 * The notifications of one daemon, wired: the stores on the database, the
 * notifier on the run events, and what the API's procedures call. The
 * daemon makes one per engine and keeps the in-app channel across
 * `bun --hot` reloads, so an open stream outlives a reload.
 */

export type NotificationsOptions = {
	db: Database;
	/** Better Auth: session end and live checks for push targets. */
	auth: Auth;
	events: RunEventSource;
	/** Whether this daemon sends the pushes of the Space (`oneSenderPerSpace`). */
	sendsFor(spaceId: string): Promise<boolean>;
	inApp: InAppChannel;
	/** The push channels this daemon has. Default: none, the in-app stream only. `stop` stops them too. */
	push?: PushChannels;
	/**
	 * Web Push from this daemon, with the VAPID keys it keeps (made once).
	 * `subject`: an `https:` URL or a `mailto:` address that push services
	 * may contact. Without it, browsers get no pushes from this daemon.
	 */
	webPush?: {
		subject: string;
		sender?: WebPushSender;
		/** Makes a new VAPID key pair. Default: `web-push`'s. */
		generateKeys?: () => VapidKeys;
	};
	now?: () => number;
	tickMs?: number;
	/** The time zone of a Person without settings. Default: this computer's. */
	timeZone?: string;
};

export type Notifications = {
	/**
	 * The Person's in-app stream: every event of every Space they are in,
	 * until `signal` aborts. `here`: the screen is on this computer.
	 * `phone`: the phone app, which counts as closed once it leaves the front.
	 */
	watch(
		personId: string,
		signal: AbortSignal,
		options?: WatchOptions,
	): AsyncGenerator<InAppItem>;
	settings: {
		get(personId: string): Promise<NotificationSettings>;
		save(
			personId: string,
			patch: NotificationSettingsPatch,
		): Promise<NotificationSettings>;
		/** The one-time copy of the switches a computer kept, for a Person without settings. */
		seed(personId: string, switches: ComputerSwitches): Promise<void>;
		/**
		 * After a save of the computer's settings: when it changed one of
		 * the three switches, the Person's events take their values.
		 */
		adoptComputerSwitches(
			personId: string,
			patch: Partial<Record<keyof ComputerSwitches, unknown>>,
			switches: ComputerSwitches,
		): Promise<void>;
	};
	targets: {
		list(personId: string): Promise<PushTargetView[]>;
		register(
			personId: string,
			input: RegisterTarget,
			sessionId?: string | null,
		): Promise<PushTargetView>;
		/**
		 * Removes one of the Person's screens. A phone is also signed out:
		 * its session ends. Null when the Person has no target of that id.
		 */
		remove(personId: string, id: string): Promise<PushTargetView | null>;
	};
	webPush: {
		/** The public VAPID key a browser subscribes with. Null: this daemon sends no Web Push. */
		publicKey(): Promise<string | null>;
	};
	/**
	 * Tells the open screens of every Member of the Space that a run
	 * changed without an event of its own: an answer, a stop or a resume is
	 * on its way to the Device that walks it, or that Device applied or
	 * refused it. Quiet: no push. A screen reads the run and its Gate again.
	 * A Gate with an answer on its way closes everywhere: its in-app item
	 * and its pushes are withdrawn, as if it closed.
	 */
	runChanged(spaceId: string, runId: string): Promise<void>;
	/**
	 * Tells the open screens of every Member of the Space that a project's
	 * schedules changed without a run (a pause tonight). Quiet: no push.
	 */
	schedulesChanged(spaceId: string, projectId: string): Promise<void>;
	/**
	 * Tells the open screens of the Space's Members that the learnings that
	 * wait in a project changed: a step proposed some, or a person kept or
	 * deleted some, on any Device of the Space. Quiet: no push. A push says
	 * what waits, and the Gate that reviews them already does.
	 */
	learningsChanged(spaceId: string, projectId: string): Promise<void>;
	/**
	 * Tells the open screens of the Space's Members that its projects
	 * changed: its Host added, renamed or removed one. Quiet: no push.
	 */
	projectsChanged(spaceId: string): Promise<void>;
	/**
	 * Tells open screens that a synced document was written. The Members of
	 * `spaceId`, or `personId` for this computer's own document. Quiet: no push.
	 */
	documentChanged(change: {
		name: string;
		spaceId?: string;
		personId?: string;
	}): Promise<void>;
	/** Reads the open Gates, then listens to the run events. */
	start(): Promise<void>;
	stop(): void;
};

export function createNotifications(
	options: NotificationsOptions,
): Notifications {
	const { db, auth } = options;
	const now = options.now ?? timeNow;
	const spaces = wireSpaces({ db });
	const login = wireLogin({ auth, db });
	const settings = wireSettings({
		db,
		...(options.timeZone ? { timeZone: options.timeZone } : {}),
	});
	/**
	 * The Person a call of `settings` or `targets` is for: the API passes
	 * the signed-in Person, the daemon this computer's owner.
	 */
	const person = (personId: string): PersonActor => ({
		personId,
		door: "session",
	});
	const targets = wireTargets({
		db,
		clock: now,
		sessions: {
			live: (sessionIds, at) => login.listLiveSessions({ sessionIds, at }),
			end: async (personId, sessionId) => {
				await login.endSession({ personId, sessionId });
			},
		},
	});
	const vapid = options.webPush
		? createVapidKeyStore(db, options.webPush.generateKeys)
		: null;
	const push: PushChannels = { ...options.push };
	if (options.webPush && vapid) {
		push.web = createWebPushChannel({
			keys: vapid,
			subject: options.webPush.subject,
			...(options.webPush.sender ? { sender: options.webPush.sender } : {}),
		});
	}
	/**
	 * Who may see the runs of a Space: its Members, in every role. A viewer
	 * sees a Gate too, without its options.
	 */
	const audience = async (spaceId: string) =>
		(await spaces.members.listRoster({ spaceId })).map((member) => member.id);
	const notifier = wireNotifier({
		db,
		events: options.events,
		audience: { of: audience },
		spaces: { all: () => spaces.listSpaceIds() },
		sendsFor: { sends: (spaceId) => options.sendsFor(spaceId) },
		mayAnswer: {
			allows: async (spaceId, personId) => {
				const role = await spaces.findRole({ personId, spaceId });
				return role !== null && roleAllows(role, { gate: ["resolve"] });
			},
		},
		settings: {
			get: (personId) => settings.read(NIGHT_SHIFT, { personId }),
		},
		targets: {
			of: (personId) => targets.listTargets({ personId }),
			byIds: (ids) => targets.findTargets({ ids }),
			forget: (id) => targets.forgetTarget({ id }),
		},
		inApp: options.inApp,
		pushes: push,
		now,
		...(options.tickMs ? { tickMs: options.tickMs } : {}),
	});
	return {
		watch: (personId, signal, watch) =>
			options.inApp.watch(personId, signal, watch),
		settings: {
			get: (personId) => settings.read(person(personId), { personId }),
			save: (personId, patch) =>
				settings.save(person(personId), { personId, patch }),
			seed: (personId, switches) => settings.seed({ personId, switches }),
			adoptComputerSwitches: (personId, patch, switches) =>
				settings.adoptSwitches({ personId, patch, switches }),
		},
		targets: {
			list: (personId) => targets.list(person(personId), { personId }),
			register: (personId, screen, sessionId = null) =>
				targets.register(person(personId), { personId, screen, sessionId }),
			remove: (personId, id) =>
				targets.remove(person(personId), { personId, id }),
		},
		webPush: {
			publicKey: async () => (vapid ? (await vapid.get()).publicKey : null),
		},
		async runChanged(spaceId, runId) {
			for (const personId of await audience(spaceId)) {
				options.inApp.runChanged(
					{ kind: "in-app", personId },
					{ spaceId, runId },
				);
			}
			await notifier.commandsChanged(spaceId, runId);
		},
		async schedulesChanged(spaceId, projectId) {
			for (const personId of await audience(spaceId)) {
				options.inApp.schedulesChanged(
					{ kind: "in-app", personId },
					{ spaceId, projectId },
				);
			}
		},
		async learningsChanged(spaceId, projectId) {
			for (const personId of await audience(spaceId)) {
				options.inApp.learningsChanged(
					{ kind: "in-app", personId },
					{ spaceId, projectId },
				);
			}
		},
		async projectsChanged(spaceId) {
			for (const personId of await audience(spaceId)) {
				options.inApp.projectsChanged(
					{ kind: "in-app", personId },
					{ spaceId },
				);
			}
		},
		async documentChanged({ name, spaceId, personId }) {
			const people = personId
				? [personId]
				: spaceId
					? await audience(spaceId)
					: [];
			for (const id of people) {
				options.inApp.documentChanged(
					{ kind: "in-app", personId: id },
					{ name, spaceId: spaceId ?? null },
				);
			}
		},
		start: () => notifier.start(),
		stop: () => {
			notifier.stop();
			for (const channel of Object.values(push)) channel.stop?.();
		},
	};
}

/** The engine's run events, missed schedules, open Gates and flows that turn severe. */
export function engineRunEvents(
	engine: Pick<
		Engine,
		"onLandedFacts" | "onScheduleMissed" | "space" | "dashboard"
	>,
): RunEventSource {
	return {
		subscribe: (listener) => engine.onLandedFacts(listener),
		onScheduleMissed: (listener) => engine.onScheduleMissed(listener),
		severeTurn: (spaceId, runId) =>
			engine.dashboard.readSevereTurn(NIGHT_SHIFT, {
				spaceId,
				runId,
				now: timeNow(),
			}),
		async openGates(spaceId) {
			const gates = await engine.space(spaceId, NIGHT_SHIFT).listGates();
			return gates.map((g) => ({
				runId: g.runId,
				stepId: g.stepId,
				lockScreen: g.lockScreen,
				choices: g.choices.map((choice) => choice.name),
				answerPending: g.answerPending,
			}));
		},
		async run(spaceId, runId) {
			const run = await engine
				.space(spaceId, NIGHT_SHIFT)
				.getRun(runId)
				.catch(() => null);
			if (!run) return null;
			return {
				title: run.title,
				personId: run.startedBy?.id ?? null,
				stopAt: run.stopAt,
				sleeping: run.status === "sleeping",
			};
		},
	};
}
