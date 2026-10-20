import {
	type AgentNode,
	type AgentProfileSettings,
	type FlowNode,
	nameSchema,
	permissionModeSchema,
} from "@nightshift/flows";
import { z } from "zod";
import type {
	Device,
	ExecEvent,
	ExecInput,
	OfferedSessionInput,
	SessionEvent,
	SessionInput,
	WorkCall,
} from "../device";
import type { DeviceDocument } from "../device-config";
import type { SpaceDocument } from "../projects";

/**
 * Offers: an Agent Profile of a Device made available to one Space, with
 * two caps: the most permissive permission mode its sessions may run in,
 * and how many of its sessions may run at once. An Offer is the only way a
 * Member runs anything on a Device another Person owns.
 *
 * An Offer lives in two places, each with its own Owner:
 *
 * - The Device document's `offers` (`DeviceOffer`): the Device's own
 *   configuration, private to its owner. The caps the Device enforces
 *   come from here, never from what a Host sends.
 * - The Space document's `offers` (`SpaceOffer`): the publication, for
 *   the Space's Members. Device id and name, profile name, caps, when and
 *   by whom: never the profile's settings, tools or secrets. The Replica
 *   that keeps the Space writes it, through the procedures.
 *
 * An Offer is in force when both hold it (`inForce`): withdrawing on
 * either side ends it.
 *
 * Two checks, two code paths. The Walker refuses at run start a flow
 * whose nodes would do on that Device anything but run an offered profile
 * (`offerRefusal`). The Device checks every call again from its own
 * Replica (`offeredCallRefusal`), resolves the profile itself
 * (`offeredSession`), clamps the permission mode to the cap and queues a
 * session over the session cap (`createOfferSlots`).
 */

/** The permission modes from the narrowest to the widest. */
export const PERMISSION_ORDER = [
	"plan",
	"default",
	"acceptEdits",
	"auto",
	"bypassPermissions",
] as const satisfies readonly z.infer<typeof permissionModeSchema>[];
export type PermissionMode = (typeof PERMISSION_ORDER)[number];

/** The most sessions one Offer may run at once. */
export const MAX_SESSION_CAP = 16;

/** Whether `mode` is no wider than `cap`. */
export function withinCap(mode: PermissionMode, cap: PermissionMode): boolean {
	return PERMISSION_ORDER.indexOf(mode) <= PERMISSION_ORDER.indexOf(cap);
}

/** `mode`, narrowed to `cap` when it is wider. */
export function clampToCap(
	mode: PermissionMode,
	cap: PermissionMode,
): PermissionMode {
	return withinCap(mode, cap) ? mode : cap;
}

export const offerCapsSchema = z.object({
	permissionCap: permissionModeSchema,
	sessionCap: z.number().int().min(1).max(MAX_SESSION_CAP),
});
export type OfferCaps = z.infer<typeof offerCapsSchema>;

const deviceOfferSchema = offerCapsSchema.extend({
	spaceId: z.string().min(1),
	profile: nameSchema,
	offeredAt: z.number(),
});
/** An Offer as the offering Device's own document holds it. */
export type DeviceOffer = z.infer<typeof deviceOfferSchema>;

const spaceOfferSchema = offerCapsSchema.extend({
	deviceId: z.string().min(1),
	deviceName: z.string(),
	profile: nameSchema,
	offeredAt: z.number(),
	/** The Person who made it. */
	by: z.string().nullable(),
});
/** An Offer as the Space document publishes it to the Members. */
export type SpaceOffer = z.infer<typeof spaceOfferSchema>;

const deviceKey = (spaceId: string, profile: string) => `${spaceId}/${profile}`;
const spaceKey = (deviceId: string, profile: string) =>
	`${deviceId}/${profile}`;

/** The Device's own Offers, every Space. An entry this version cannot read is skipped. */
export function deviceOffers(
	document: Pick<DeviceDocument, "offers">,
): DeviceOffer[] {
	const offers: DeviceOffer[] = [];
	for (const value of document.offers.values()) {
		const parsed = deviceOfferSchema.safeParse(value);
		if (parsed.success) offers.push(parsed.data);
	}
	return offers.sort((a, b) => a.offeredAt - b.offeredAt);
}

/** Makes or changes one of the Device's own Offers. The Owner calls this. */
export function setDeviceOffer(
	document: DeviceDocument,
	offer: DeviceOffer,
): Promise<void> {
	return document.change(() => {
		document.offers.set(deviceKey(offer.spaceId, offer.profile), offer);
	});
}

/** Removes one of the Device's own Offers. */
export function removeDeviceOffer(
	document: DeviceDocument,
	spaceId: string,
	profile: string,
): Promise<void> {
	const key = deviceKey(spaceId, profile);
	if (!document.offers.has(key)) return Promise.resolve();
	return document.change(() => {
		document.offers.delete(key);
	});
}

/** The Offers a Space document lists, of one Device or of every Device. */
export function spaceOffers(
	document: Pick<SpaceDocument, "offers">,
	deviceId?: string,
): SpaceOffer[] {
	const offers: SpaceOffer[] = [];
	for (const value of document.offers.values()) {
		const parsed = spaceOfferSchema.safeParse(value);
		if (!parsed.success) continue;
		if (deviceId !== undefined && parsed.data.deviceId !== deviceId) continue;
		offers.push(parsed.data);
	}
	return offers.sort((a, b) => a.offeredAt - b.offeredAt);
}

/** Publishes an Offer in the Space document, in a change of the Replica that keeps it. */
export function publishOffer(document: SpaceDocument, offer: SpaceOffer): void {
	document.offers.set(spaceKey(offer.deviceId, offer.profile), offer);
}

/** Takes an Offer off the Space document, in a change. False when it was not there. */
export function unpublishOffer(
	document: SpaceDocument,
	deviceId: string,
	profile: string,
): boolean {
	const key = spaceKey(deviceId, profile);
	if (!document.offers.has(key)) return false;
	document.offers.delete(key);
	return true;
}

/**
 * The Device's Offers into a Space that are in force: its own document
 * holds them (with the caps it enforces) and the Space document still
 * lists them for this Device.
 */
export function inForce(
	own: readonly DeviceOffer[],
	listed: readonly SpaceOffer[],
	spaceId: string,
): DeviceOffer[] {
	const published = new Set(listed.map((o) => o.profile));
	return own.filter((o) => o.spaceId === spaceId && published.has(o.profile));
}

/** "`a`, `b`" for a message. */
function names(offers: readonly { profile: string }[]): string {
	return offers.map((o) => `"${o.profile}"`).join(", ");
}

/** What a Device offers into a Space, for a refusal. */
function offersNothingOr(
	deviceName: string,
	offers: readonly { profile: string }[],
	not?: string,
): string {
	if (offers.length === 0) {
		return `${deviceName} offers nothing to this Space. Its owner can offer a profile on the Agents page.`;
	}
	return `${deviceName} offers ${names(offers)} to this Space${not ? `, not "${not}"` : ""}.`;
}

/** The fields an Agent node may not set on another Person's Device: the offered profile sets them. */
const OWN_SETTINGS = [
	"harness",
	"model",
	"effort",
	"clis",
	"nodeClis",
	"connections",
	"mcpServers",
	"checker",
] as const satisfies readonly (keyof AgentNode)[];

/**
 * Whether a node's step touches its Device beyond the run's worktree: a
 * process, a tool, a harness or the decider. Gates, rules, waits for a
 * time or a signal, and calls of other flows touch nothing.
 *
 * A switch on the node type, on purpose: it is the Offer's rule (what an
 * Offer lets another Person run), not a fact of each kind.
 */
function touchesDevice(node: FlowNode): boolean {
	switch (node.type) {
		case "agent":
		case "command":
		case "tool":
			return true;
		case "decision":
		case "value":
			return node.by === "model";
		case "wait":
			return node.until.kind === "command";
		case "call":
			return node.each?.source.kind === "command";
	}
}

/** What a run start knows of the Offers of the Device it places a run of another Person on. */
export type OfferedPlacement = {
	deviceName: string;
	/** Its Offers into the run's Space. */
	offers: readonly Pick<SpaceOffer, "profile" | "permissionCap">[];
	/** The starter's role in the Space uses Offers (`offer.use`). */
	mayUse: boolean;
};

/** The refusal of a run on another Person's Device that offers nothing to the Space. */
export function offersNothing(deviceName: string): string {
	return `${deviceName} is not your device. It offers nothing to this Space. A run can use your own devices, or a profile another person offers to this Space.`;
}

/**
 * The Walker's check at run start, for a run placed on a Device another
 * Person owns: every node that touches that Device is an Agent node that
 * names a profile it offers to the Space, sets nothing the profile sets,
 * and asks for no wider permission mode than the cap. Null when the flow
 * passes. The Device checks again, call by call.
 */
export function offerRefusal(
	nodes: readonly FlowNode[],
	placed: OfferedPlacement,
): string | null {
	const { deviceName, offers } = placed;
	// A flow that touches nothing there (Gates, rules, waits) needs no Offer.
	if (!nodes.some(touchesDevice)) return null;
	if (!placed.mayUse) {
		return `${deviceName} is not your device, and your role in this Space does not allow using what others offer.`;
	}
	if (offers.length === 0) return offersNothing(deviceName);
	const others = nodes.filter((n) => n.type !== "agent" && touchesDevice(n));
	if (others.length > 0) {
		return `${deviceName} is not your device. It runs only Agent nodes with a profile its owner offers to this Space, not ${others.map((n) => `"${n.id}"`).join(", ")}. Choose one of your own devices for this run.`;
	}
	for (const node of nodes) {
		if (node.type !== "agent") continue;
		const offer = offers.find((o) => o.profile === node.profile);
		if (node.profile === undefined || !offer) {
			return node.profile === undefined
				? `The Agent node "${node.id}" names no profile. ${offersNothingOr(deviceName, offers)}`
				: `${offersNothingOr(deviceName, offers, node.profile)} Change the profile of "${node.id}".`;
		}
		const own = OWN_SETTINGS.filter((field) => node[field] !== undefined);
		if (own.length > 0) {
			return `The Agent node "${node.id}" sets its own ${own.join(", ")}. On ${deviceName}, the offered profile "${offer.profile}" runs as its owner set it. Remove them from the node.`;
		}
		if (
			node.permissionMode !== undefined &&
			!withinCap(node.permissionMode, offer.permissionCap)
		) {
			return `The Agent node "${node.id}" asks for the permission mode ${node.permissionMode}, but ${deviceName} offers "${offer.profile}" with ${offer.permissionCap} at most. Choose ${offer.permissionCap} or a narrower mode.`;
		}
	}
	return null;
}

/**
 * The offering Device's check of one call of another Person's run, given
 * its Offers in force into the run's Space: an offered session of one of
 * them, or the run's own folder work (its flows, its worktree, its files,
 * its item branches, the Hand-off of its work to and from it). Anything else is refused: a command, a tool, the
 * decider, a session it did not offer, and its capabilities (private to
 * its owner). Null when it serves the call.
 */
export function offeredCallRefusal(
	call: WorkCall,
	deviceName: string,
	offers: readonly DeviceOffer[],
): string | null {
	if (offers.length === 0) return offersNothingOr(deviceName, offers);
	switch (call.kind) {
		case "flows":
		case "worktree":
		case "files":
		case "itemBranch":
		case "handOff":
		case "receiveHandOff":
			return null;
		case "session": {
			if (!("offered" in call.input)) {
				return `${deviceName} runs only the profiles its owner offers to this Space. ${offersNothingOr(deviceName, offers)}`;
			}
			const { profile } = call.input.offered;
			return offers.some((o) => o.profile === profile)
				? null
				: offersNothingOr(deviceName, offers, profile);
		}
		default:
			return `${deviceName} runs only the profiles its owner offers to this Space. ${offersNothingOr(deviceName, offers)}`;
	}
}

/**
 * An offered session as the offering Device runs it: its profile as its
 * owner set it (harness, model, effort, CLI tools, connections), and the
 * permission mode the node asks for, else the profile's, never wider than
 * the Offer's cap.
 */
export function offeredSession<T extends Omit<OfferedSessionInput, "signal">>(
	input: T,
	profile: AgentProfileSettings,
	cap: PermissionMode,
): Omit<SessionInput, "signal"> & Omit<T, "offered"> {
	const { offered, ...rest } = input;
	return {
		...rest,
		harness: profile.harness,
		model: profile.model,
		permissionMode: clampToCap(
			offered.permissionMode ?? profile.permissionMode,
			cap,
		),
		...(profile.effort !== undefined ? { effort: profile.effort } : {}),
		...(profile.clis.length > 0 ? { clis: profile.clis } : {}),
		...(profile.connections.length > 0
			? { connections: profile.connections }
			: {}),
	};
}

/** The sessions running under each Offer, at most its cap at once. */
export type OfferSlots = {
	/**
	 * Waits for a free session of the Offer (`key`), first come first
	 * served, and resolves to its release. A session over the cap waits;
	 * it is not refused. Rejects when `signal` aborts while it waits.
	 */
	take(key: string, cap: number, signal: AbortSignal): Promise<() => void>;
	/** The sessions running under the Offer now. */
	running(key: string): number;
};

/** The key of an Offer's slots. */
export const slotKey = (spaceId: string, profile: string) =>
	deviceKey(spaceId, profile);

export function createOfferSlots(): OfferSlots {
	const running = new Map<string, number>();
	const waiting = new Map<string, (() => void)[]>();

	function release(key: string) {
		running.set(key, (running.get(key) ?? 1) - 1);
		waiting.get(key)?.shift()?.();
	}

	return {
		running: (key) => running.get(key) ?? 0,
		async take(key, cap, signal) {
			while ((running.get(key) ?? 0) >= cap) {
				if (signal.aborted) throw new Error("The session was stopped.");
				await new Promise<void>((resolve, reject) => {
					const queue = waiting.get(key) ?? [];
					waiting.set(key, queue);
					const wake = () => {
						signal.removeEventListener("abort", stop);
						resolve();
					};
					const stop = () => {
						const at = queue.indexOf(wake);
						if (at >= 0) queue.splice(at, 1);
						reject(new Error("The session was stopped."));
					};
					queue.push(wake);
					signal.addEventListener("abort", stop, { once: true });
				});
			}
			running.set(key, (running.get(key) ?? 0) + 1);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				release(key);
			};
		},
	};
}

/**
 * This computer as the Device of another Person's run that it walks
 * itself (the Walker is the offering Device): the same rule as for a run
 * walked elsewhere. A session runs only an offered profile, resolved here
 * against the Offers in force when it starts, with the caps; a command, a
 * tool and the decider are refused; the run's folder work passes.
 */
export function offeredDevice(
	inner: Device,
	deps: {
		/** The Offers in force into the run's Space, read at each session. */
		inForce(): Promise<DeviceOffer[]>;
		profileFor(name: string): AgentProfileSettings | null;
		slots: OfferSlots;
		spaceId: string;
		/** Called while an offered session runs, until the returned function is called. */
		track?(profile: string): () => void;
		/** Whether the run is the Device owner's own after all: then it is the Device as is. */
		own?(): Promise<boolean>;
	},
): Device {
	const own = () => deps.own?.() ?? Promise.resolve(false);
	const refused = (offers: readonly DeviceOffer[]) =>
		`${inner.name} runs only the profiles its owner offers to this Space. ${offersNothingOr(inner.name, offers)}`;

	async function* session(
		input: SessionInput | OfferedSessionInput,
	): AsyncGenerator<SessionEvent> {
		if (await own()) {
			yield* inner.session(input);
			return;
		}
		const offers = await deps.inForce();
		if (!("offered" in input)) {
			yield { type: "refused", message: refused(offers) };
			return;
		}
		const { signal } = input;
		const { profile } = input.offered;
		const offer = offers.find((o) => o.profile === profile);
		const settings = offer ? deps.profileFor(profile) : null;
		if (!offer || !settings) {
			yield {
				type: "refused",
				message: offer
					? `${inner.name} no longer has the profile "${profile}".`
					: offersNothingOr(inner.name, offers, profile),
			};
			return;
		}
		let release: () => void;
		try {
			release = await deps.slots.take(
				slotKey(deps.spaceId, profile),
				offer.sessionCap,
				signal,
			);
		} catch (error) {
			yield {
				type: "refused",
				message: error instanceof Error ? error.message : String(error),
			};
			return;
		}
		const untrack = deps.track?.(profile);
		try {
			yield* inner.session({
				...offeredSession(input, settings, offer.permissionCap),
				signal,
			});
		} finally {
			untrack?.();
			release();
		}
	}

	async function* exec(input: ExecInput): AsyncGenerator<ExecEvent> {
		if (await own()) {
			yield* inner.exec(input);
			return;
		}
		yield {
			type: "exit",
			exitCode: null,
			spawnError: refused(await deps.inForce()),
		};
	}

	return {
		...inner,
		session,
		exec,
		async callTool(input) {
			if (await own()) return inner.callTool(input);
			return { kind: "refused", message: refused(await deps.inForce()) };
		},
		decide: (async (input: Parameters<Device["decide"]>[0]) => {
			if (await own()) return inner.decide(input as never);
			return {
				kind: "error",
				errorKind: "harness",
				message: refused(await deps.inForce()),
				costUsd: null,
			};
		}) as Device["decide"],
	};
}
