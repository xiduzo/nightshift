/** The moves of a secret saved on another of the Person's Devices. */

export type { OwnSecrets } from "./application/ports";
export {
	type SecretMoves,
	type SecretMovesHost,
	wireMoves,
} from "./wire";
