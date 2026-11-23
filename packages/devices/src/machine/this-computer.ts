import { existsSync } from "node:fs";
import { hostname } from "node:os";

/** Whether this process runs in a Docker or Podman container. */
export function inContainer(): boolean {
	return existsSync("/.dockerenv") || existsSync("/run/.containerenv");
}

/**
 * What this computer says of itself, read at each call: its host name,
 * whether it is a container, its platform and its environment. The
 * registry names this computer's Device from them (`ThisComputer`).
 */
export const thisComputer = {
	hostName: (): string => hostname(),
	inContainer,
	platform: (): string => process.platform,
	env: (): Record<string, string | undefined> => process.env,
};
