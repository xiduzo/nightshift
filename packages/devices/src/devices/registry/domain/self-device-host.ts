/**
 * The default name of this computer's Device (`ensureSelfDevice`). Pure:
 * what the computer says of itself comes in as an argument.
 */

/** This computer's Device: the one `device` row with `self` set. */
export type SelfDevice = { id: string; name: string };

export type SelfDeviceHost = {
	name: string;
	platform: string;
	/**
	 * A name an earlier default gave, which `name` now replaces: the host
	 * name before NIGHTSHIFT_DEVICE_NAME was set, or a container id or "Host"
	 * in a container. A name the person chose is never stale.
	 */
	stale?: (name: string) => boolean;
};

/** What the computer says of itself, as the default name reads it. */
export type ComputerFacts = {
	env: Record<string, string | undefined>;
	hostName: string;
	container: boolean;
	platform: string;
	dev?: boolean | undefined;
};

/** The host name without the `.local` that macOS adds. */
export function hostDeviceName(name: string): string {
	return name.replace(/\.local$/i, "") || "This computer";
}

/** The host name Docker gives a container: the first 12 (or all 64) hex digits of its id. */
export function isContainerId(name: string): boolean {
	return /^(?:[0-9a-f]{12}|[0-9a-f]{64})$/.test(name);
}

/** The host name of the first of NIGHTSHIFT_HOST_ADDRESSES, or null. */
function addressName(addresses: string | undefined): string | null {
	for (const address of (addresses ?? "").split(",")) {
		try {
			const name = new URL(address.trim()).hostname;
			if (name) return name;
		} catch {}
	}
	return null;
}

/**
 * This computer's default Device name and platform: NIGHTSHIFT_DEVICE_NAME
 * when set, else the host name. A container whose host name is its id
 * cannot see the name of its computer: its default is the name in its first
 * Host address, else "Host".
 *
 * A dev daemon (`dev`, NIGHTSHIFT_DEV) runs beside the desktop app on the
 * same computer: its default is "<host name> (dev)", so the two Devices do
 * not share a name (ADR 17). A dev Device still named after the host name
 * takes it too.
 */
export function selfDeviceHost(facts: ComputerFacts): SelfDeviceHost {
	const { env, container } = facts;
	const raw = hostDeviceName(facts.hostName);
	const unnamed = container && isContainerId(raw);
	const chosen = env.NIGHTSHIFT_DEVICE_NAME?.trim();
	const fallback = unnamed
		? addressName(env.NIGHTSHIFT_HOST_ADDRESSES) || "Host"
		: raw;
	const name = chosen || (facts.dev ? `${fallback} (dev)` : fallback);
	return {
		name,
		platform: facts.platform,
		stale: (current) =>
			current !== name &&
			(current === raw ||
				(container && (isContainerId(current) || current === "Host"))),
	};
}
