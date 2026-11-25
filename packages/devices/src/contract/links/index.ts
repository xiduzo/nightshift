/** A Device's link to its Host and pairing: what they exchange, and their procedures. */

export {
	type HostHello,
	hostHelloSchema,
	type ListedSpace,
	type PairingRedeemed,
	type PairingStart,
	type PhoneView,
	pairingRedeemedSchema,
	pairingStartSchema,
	phoneSchema,
} from "./links";
export { linkProcedures, pairingProcedures } from "./procedures";
