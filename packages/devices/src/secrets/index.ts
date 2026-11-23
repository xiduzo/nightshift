/**
 * The secrets a Host keeps (ADR 13), sealed at rest: the Person's Personal
 * secrets (the store, the Home Host's half that serves them to the
 * Person's own Devices, and the Device's half that asks its Home Host, or
 * keeps them itself without one), and the Project secrets (the store, the
 * half of the Host that keeps the Space, which serves them to the Device
 * a step of the Project's run is placed on, and the Device's half). And
 * the moves of a secret saved on another of the Person's Devices: the
 * Device that asks, the Home Host that relays, and the Device that moves
 * its own value.
 */

export type { OwnSecrets, SecretMoves, SecretMovesHost } from "./moves";
export type { PersonalSecretsHost } from "./personal";
export type { ProjectSecretsHost } from "./projects";
export { wireSecrets } from "./wire";
