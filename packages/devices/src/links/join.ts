import {
	isHostAddress,
	isLoopbackHost,
} from "@nightshift/engine/device-config";
import { Refusal } from "@nightshift/refusal";
import { now } from "@nightshift/time";
import { hostCertificate } from "../reach";
import { pause } from "./backoff";
import { DEV_STAYS_LOCAL, isLocalAddress } from "./dev-link";
import { hostClient } from "./host-client";
import {
	type DeviceKeyStore,
	type HostLink,
	type HostLinks,
	type HostRole,
	SECOND_HOME,
} from "./host-links";
import type { JoinProgress } from "./types";

/**
 * `nightshift join <host-url>`: pairs this computer with a Host by device
 * authorization. It asks the Host for a code, yields it (with the
 * fingerprint of a self-signed certificate, to compare), polls until the
 * Host's Person approves, then keeps the key (`keys`) and the link
 * (`links`), and starts the link (`started`). Callable from code: the
 * daemon serves it as `devices.join`, the CLI and later the desktop app
 * call that.
 */
export type JoinDeps = {
	self: { id: string; name: string; platform: string };
	links: Pick<HostLinks, "home" | "save">;
	keys: DeviceKeyStore;
	/** The pairing is done: start the link. */
	started(link: HostLink, key: string): void | Promise<void>;
	/**
	 * How this install tells a home Host which computer it is on, and takes
	 * over the Device the Host knows that computer as (ADR 20). Left out: it
	 * says nothing, and it stays the Device it is.
	 */
	identity?: {
		/** This computer's fingerprint. Null: it has none. */
		machine: string | null;
		/** The key store of that Device: the keychain keeps keys per Device. */
		keysOf(deviceId: string): Promise<DeviceKeyStore>;
		/**
		 * This install becomes that Device from its next start, and counts
		 * its events on from `walkerSeq`, the last the Host has of it.
		 */
		adopt(deviceId: string, walkerSeq: number): Promise<void>;
	};
	/** A development install that stays off every Host but this computer's (ADR 20). */
	localOnly?: boolean;
	/** Waits between polls. Default: a timer that the signal ends. */
	sleep?(ms: number, signal?: AbortSignal): Promise<void>;
};

export async function* joinHost(
	deps: JoinDeps,
	input: { url: string; role: HostRole },
	signal?: AbortSignal,
): AsyncGenerator<JoinProgress> {
	const address = hostOrigin(input.url);
	if (deps.localOnly && !isLocalAddress(address)) {
		throw new Refusal("conflict", DEV_STAYS_LOCAL);
	}
	if (input.role === "home") {
		const home = await deps.links.home();
		if (home && !home.addresses.includes(address)) {
			throw new Refusal("conflict", SECOND_HOME);
		}
	}

	const certificate = await hostCertificate(address);
	// A certificate this computer trusts already needs no pin.
	const pinned = certificate && !certificate.trusted ? certificate : null;
	const host = hostClient(address, { certificate: pinned?.pem ?? null });

	const code = await host.pairing
		.start(
			{
				deviceId: deps.self.id,
				name: deps.self.name,
				platform: deps.self.platform,
				home: input.role === "home",
				// A guest Host is another Person's: it never hears of this computer.
				...(input.role === "home" && deps.identity?.machine
					? { machine: deps.identity.machine }
					: {}),
			},
			{ signal },
		)
		.catch((error: unknown) => {
			throw certificateError(error) ?? error;
		});
	yield {
		kind: "code",
		userCode: code.userCode,
		verificationUri: hostPage(code.verificationUri, address),
		verificationUriComplete: hostPage(code.verificationUriComplete, address),
		fingerprint: pinned?.fingerprint ?? null,
		expiresAt: now() + code.expiresIn * 1000,
	};

	const sleep = deps.sleep ?? pause;
	let interval = code.interval * 1000;
	while (true) {
		await sleep(interval, signal);
		if (signal?.aborted) throw new Error("The pairing was stopped.");
		const answer = await host.pairing.redeem(
			{
				deviceCode: code.deviceCode,
				deviceId: deps.self.id,
				home: input.role === "home",
				address,
			},
			{ signal },
		);
		switch (answer.status) {
			case "pending":
				continue;
			case "slow-down":
				interval += 5_000;
				continue;
			case "denied":
				throw new Refusal("forbidden", "The pairing was declined on the Host.");
			case "expired":
				throw new Refusal(
					"conflict",
					"The code expired. Run the pairing again.",
				);
			case "joined": {
				// Another Device than this install: its key goes under that Device.
				const adopted =
					deps.identity &&
					answer.deviceId !== undefined &&
					answer.deviceId !== deps.self.id
						? answer.deviceId
						: null;
				const keys =
					adopted !== null && deps.identity
						? await deps.identity.keysOf(adopted)
						: deps.keys;
				await keys.set(answer.host.id, answer.key);
				const addresses = [...answer.host.addresses];
				if (!addresses.includes(address)) addresses.push(address);
				const link = await deps.links.save({
					hostId: answer.host.id,
					name: answer.host.name,
					addresses,
					certificate: pinned?.pem ?? null,
					fingerprint: pinned?.fingerprint ?? null,
					role: input.role,
					personId: answer.personId,
					keyStore: keys.kind,
				});
				// Last: a failure before it leaves this install what it was.
				if (adopted !== null) {
					await deps.identity?.adopt(adopted, answer.walkerSeq ?? 0);
				}
				// This process keeps the old id, so that link waits for the next start.
				else await deps.started(link, answer.key);
				yield {
					kind: "joined",
					hostId: link.hostId,
					hostName: link.name,
					role: link.role,
					hostAdmin: answer.hostAdmin ?? null,
					...(adopted !== null ? { restart: true } : {}),
				};
				return;
			}
		}
	}
}

/**
 * The Host's origin. Join addresses are `https://` only; a loopback
 * `http://` one is allowed for tests and local development.
 */
export function hostOrigin(url: string): string {
	const trimmed = url.trim();
	const withScheme = /^[a-z]+:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;
	if (!isHostAddress(withScheme)) {
		throw new Refusal(
			"invalid",
			"Use the Host's https:// address, for example https://studio.example.com.",
		);
	}
	return new URL(withScheme).origin;
}

/**
 * A page of the Host, as this computer can open it. A Host names its pages
 * by the address of its own UI. On the desktop app that is `localhost`:
 * from another computer it is this computer's own Night Shift, so no page.
 */
export function hostPage(page: string, address: string): string | null {
	let url: URL;
	try {
		url = new URL(page);
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	const remote = !isLoopbackHost(new URL(address).hostname);
	if (remote && isLoopbackHost(url.hostname)) return null;
	return url.toString();
}

/**
 * A certificate this computer cannot check: neither from an authority it
 * trusts, nor one the Host signed itself (which it pins). A proxy with its
 * own private authority (Caddy's `tls internal`) is that case.
 */
function certificateError(error: unknown): Error | null {
	const codes = [error, (error as { cause?: unknown } | null)?.cause].map(
		(e) => (e as { code?: unknown } | null)?.code,
	);
	const tls = codes.some(
		(code) =>
			typeof code === "string" &&
			/CERT|ISSUER|SELF_SIGNED|LEAF_SIGNATURE/.test(code),
	);
	if (!tls) return null;
	return new Refusal(
		"conflict",
		"This computer cannot check the certificate of the Host. Give the Host a certificate from a public authority, or one it signs itself.",
	);
}
