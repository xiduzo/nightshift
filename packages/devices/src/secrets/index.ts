/**
 * The secrets a Host keeps (ADR 13), sealed at rest: the Person's Personal
 * secrets (the store, the Home Host's half that serves them to the
 * Person's own Devices, and the Device's half that asks its Home Host, or
 * keeps them itself without one), and the Project secrets (the store, the
 * half of the Host that keeps the Space, which serves them to the Device
 * a step of the Project's run is placed on, and the Device's half).
 */

export { secretsCipher } from "./cipher";
export { devicePersonalSecrets } from "./device";
export { createPersonalSecretsHost, type PersonalSecretsHost } from "./host";
export { deviceProjectSecrets } from "./project-device";
export {
	createProjectSecretsHost,
	type ProjectSecretsHost,
} from "./project-host";
export { createProjectSecretStore } from "./project-store";
export { createPersonalSecretStore } from "./store";
