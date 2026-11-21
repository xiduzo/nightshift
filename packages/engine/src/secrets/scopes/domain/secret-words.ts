import type { NotRead } from "../../../contract";
import { PERSONAL_ON_HOST } from "./secret-scopes";

/**
 * The sentences a person reads about secrets. None of them holds a value:
 * a sentence names a secret by its name only.
 */

/** What a person reads when a step needs Project secrets that cannot be read now. */
export const PROJECT_UNREACHABLE =
	"Night Shift could not read this project's secrets now. Check that this computer is online, then try again.";

/** What a person reads when a use needs Personal secrets that cannot be read now. */
export const PERSONAL_UNREACHABLE =
	"Night Shift could not read your Personal secrets now. Check that this computer is online, then try again.";

/** A save without a value. */
export const NEEDS_A_VALUE = "A secret needs a value.";

/** A move from this computer, which has no saved value of the name. */
export function noValueHere(name: string): string {
	return `This computer has no saved value of ${name}.`;
}

/** A move from the Personal secrets, which have no value of the name. */
export function notPersonal(name: string): string {
	return `${name} is not a Personal secret.`;
}

/** A move from a Project, which has no secret of the name. */
export function notInProject(name: string): string {
	return `${name} is not a secret of this project.`;
}

/** A move from a Space, which has no secret of the name. */
export function notInSpace(name: string): string {
	return `${name} is not a secret of this Space.`;
}

/**
 * The sentences a missing-secret message ends with when the Project or
 * the Personal secrets could not be read.
 */
export function unreachableNote(found: NotRead): string {
	return [
		found.projectUnreachable ? ` ${PROJECT_UNREACHABLE}` : "",
		found.unreachable ? ` ${PERSONAL_UNREACHABLE}` : "",
		found.personalHere ? ` ${PERSONAL_ON_HOST}` : "",
	].join("");
}

/** The first words of the log line when the Personal or Project secrets were not listed or read. */
export function notReadLine(
	what: "listed" | "read",
	scope: "Personal" | "Project",
): string {
	return `[secrets] the ${scope} secrets were not ${what}:`;
}
