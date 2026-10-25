import type {
	DeviceDocument,
	OfferedPlacement,
	SpaceDocument,
} from "@nightshift/engine";
import {
	type AgentNode,
	type FlowNode,
	nameSchema,
	type permissionModeSchema,
} from "@nightshift/flows";
import { z } from "zod";
import { offerCapsSchema } from "../contract";

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
 * Replica (`admission.ts`): it resolves the profile itself, clamps the
 * permission mode to the cap and queues a session over the session cap.
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
export function offersNothingOr(
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
