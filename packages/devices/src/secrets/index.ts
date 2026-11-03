/** The Person's Personal secrets (ADR 13): the store a Host keeps them in, sealed at rest, the Host's half that serves them to the Person's own Devices, and the Device's half that asks its Home Host for them, or keeps them itself without one. */

export { secretsCipher } from "./cipher";
export { devicePersonalSecrets } from "./device";
export { createPersonalSecretsHost, type PersonalSecretsHost } from "./host";
export { createPersonalSecretStore } from "./store";
