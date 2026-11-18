import { SignedInOnly } from "@/features/access";
import { ComputersScreen } from "@/features/devices";

export default function ComputersRoute() {
	return (
		<SignedInOnly>
			<ComputersScreen />
		</SignedInOnly>
	);
}
