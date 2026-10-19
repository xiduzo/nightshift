import { X509Certificate } from "node:crypto";
import { connect } from "node:tls";

/**
 * The Host's certificate, as a joining Device sees it. A Host with a
 * certificate from an authority (Let's Encrypt through Tailscale, a
 * reverse proxy, Cloudflare) needs nothing more. A Host with a self-signed
 * certificate is trusted by pinning: at pairing the Device shows the
 * certificate's SHA-256 fingerprint, the Host's Devices page shows the
 * fingerprint of the certificate it serves, the Person compares the two
 * and approves, and the Device keeps that one certificate. From then on it
 * trusts exactly that certificate for that Host (`tls.ca`), and nothing
 * else: a changed certificate stops the link.
 *
 * Bun 1.3's `fetch` and `WebSocket` do not call `checkServerIdentity`, so
 * the pin is the certificate itself as the only authority, not a callback.
 */

export type HostCertificate = {
	/** The certificate, PEM. */
	pem: string;
	/** SHA-256, colon-separated hex, as browsers show it. */
	fingerprint: string;
	/** Whether this computer trusts it already (an authority signed it). */
	trusted: boolean;
};

/** The SHA-256 fingerprint of a PEM certificate. */
export function certificateFingerprint(pem: string): string {
	return new X509Certificate(pem).fingerprint256;
}

/**
 * The certificate an `https://` address serves, read with a TLS handshake
 * that accepts any certificate (it only reads it). Null for `http://`.
 */
export async function hostCertificate(
	address: string,
): Promise<HostCertificate | null> {
	const url = new URL(address);
	if (url.protocol !== "https:") return null;
	const port = Number(url.port || 443);
	const host = url.hostname.replace(/^\[|\]$/g, "");
	return new Promise((resolve, reject) => {
		const socket = connect(
			{
				host,
				port,
				servername: isIp(host) ? undefined : host,
				rejectUnauthorized: false,
			},
			() => {
				const peer = socket.getPeerCertificate(true);
				socket.end();
				if (!peer?.raw) {
					reject(new Error(`${address} sent no certificate.`));
					return;
				}
				const pem = toPem(peer.raw);
				resolve({
					pem,
					fingerprint: certificateFingerprint(pem),
					trusted: socket.authorized,
				});
			},
		);
		socket.setTimeout(10_000, () => {
			socket.destroy();
			reject(new Error(`${address} does not answer.`));
		});
		socket.on("error", (error) => {
			reject(new Error(`${address} does not answer: ${error.message}`));
		});
	});
}

/** `fetch` that trusts only the pinned certificate, when there is one. */
export function pinnedFetch(certificate: string | null): typeof fetch {
	if (!certificate) return fetch;
	const ca = certificate;
	const pinned = (input: string | URL | Request, init?: RequestInit) =>
		fetch(input, { ...init, tls: { ca } });
	return Object.assign(pinned, { preconnect: fetch.preconnect });
}

/** A `WebSocket` class that trusts only the pinned certificate (Hocuspocus's `WebSocketPolyfill`). */
export function pinnedWebSocket(
	certificate: string | null,
): new (
	url: string | URL,
	protocols?: string | string[],
) => WebSocket {
	if (!certificate) return WebSocket;
	const ca = certificate;
	// Bun's WebSocket takes options, `tls` among them (the DOM's takes protocols only).
	const BunWebSocket = WebSocket as unknown as new (
		url: string | URL,
		options: { protocols?: string | string[]; tls: { ca: string } },
	) => WebSocket;
	return class PinnedWebSocket extends BunWebSocket {
		constructor(url: string | URL, protocols?: string | string[]) {
			super(url, {
				...(protocols ? { protocols } : {}),
				tls: { ca },
			});
		}
	};
}

function toPem(der: Buffer): string {
	const base64 =
		der
			.toString("base64")
			.match(/.{1,64}/g)
			?.join("\n") ?? "";
	return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

function isIp(host: string): boolean {
	return /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":");
}
