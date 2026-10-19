import type { JoinProgress } from "@nightshift/api/context";
import type {
	DeviceKeyStore,
	HostLink,
	HostLinks,
	HostRole,
} from "@nightshift/engine";
import { isHostAddress, SECOND_HOME } from "@nightshift/engine";

import { hostClient } from "./host-client";
import { hostCertificate } from "./tls";

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
	links: HostLinks;
	keys: DeviceKeyStore;
	/** The pairing is done: start the link. */
	started(link: HostLink, key: string): void | Promise<void>;
	/** Waits between polls. Default: a timer that the signal ends. */
	sleep?(ms: number, signal?: AbortSignal): Promise<void>;
};

export async function* joinHost(
	deps: JoinDeps,
	input: { url: string; role: HostRole },
	signal?: AbortSignal,
): AsyncGenerator<JoinProgress> {
	const address = hostOrigin(input.url);
	if (input.role === "home") {
		const home = (await deps.links.list()).find(
			(l) => l.role === "home" && !l.revokedAt,
		);
		if (home && !home.addresses.includes(address)) throw new Error(SECOND_HOME);
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
			},
			{ signal },
		)
		.catch((error: unknown) => {
			throw certificateError(error) ?? error;
		});
	yield {
		kind: "code",
		userCode: code.userCode,
		verificationUri: code.verificationUri,
		verificationUriComplete: code.verificationUriComplete,
		fingerprint: pinned?.fingerprint ?? null,
		expiresAt: Date.now() + code.expiresIn * 1000,
	};

	const sleep = deps.sleep ?? abortableSleep;
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
				throw new Error("The pairing was declined on the Host.");
			case "expired":
				throw new Error("The code expired. Run the pairing again.");
			case "joined": {
				await deps.keys.set(answer.host.id, answer.key);
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
					keyStore: deps.keys.kind,
				});
				await deps.started(link, answer.key);
				yield {
					kind: "joined",
					hostId: link.hostId,
					hostName: link.name,
					role: link.role,
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
		throw new Error(
			"Use the Host's https:// address, for example https://studio.example.com.",
		);
	}
	return new URL(withScheme).origin;
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
	return new Error(
		"This computer cannot check the certificate of the Host. Give the Host a certificate from a public authority, or one it signs itself.",
	);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}
