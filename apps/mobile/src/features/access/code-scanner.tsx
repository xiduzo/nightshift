import {
	type BarcodeScanningResult,
	CameraView,
	useCameraPermissions,
} from "expo-camera";
import { CameraOff, CircleAlert } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Linking, View } from "react-native";

import { hostAddressOf, needsHttps } from "@/shared/api";
import {
	NativeButtonRow,
	NativeCustomRow,
	NativeSection,
	NativeTextRow,
} from "@/shared/native-list";

type CodeScannerProps = {
	/** The Host address in the code. */
	onScanned(address: string): void;
	onCancel(): void;
};

const RED = "#dc2626";
const WHERE =
	'Point the camera at the code under Settings, "Use Night Shift on your phone", in Night Shift on your computer.';

/**
 * Scans the code that Night Shift shows under Settings, "Use Night Shift
 * on your phone". The code holds the Host address only. The camera asks
 * for permission first; when the person refused it, they can allow it in
 * the phone's settings or type the address. Sections of the Connect
 * screen's native list.
 */
export function CodeScanner({ onScanned, onCancel }: CodeScannerProps) {
	const [permission, requestPermission] = useCameraPermissions();
	/** What was wrong with the last code: none, no Host address, or `http://`. */
	const [wrongCode, setWrongCode] = useState<"none" | "no-address" | "http">(
		"none",
	);
	/** The camera reports a code many times a second: take the first. */
	const done = useRef(false);

	function scanned({ data }: BarcodeScanningResult) {
		if (done.current) return;
		const address = hostAddressOf(data);
		if (!address) {
			setWrongCode(needsHttps(data) ? "http" : "no-address");
			return;
		}
		done.current = true;
		onScanned(address);
	}

	// The first time, the phone asks for the camera at once.
	useEffect(() => {
		if (permission?.status === "undetermined" && permission.canAskAgain) {
			void requestPermission();
		}
	}, [permission, requestPermission]);

	const typeInstead = (
		<NativeSection>
			<NativeButtonRow label="Type the address" onPress={onCancel} />
		</NativeSection>
	);

	if (!permission) return typeInstead;

	if (!permission.granted) {
		const refused = !permission.canAskAgain;
		return (
			<>
				<NativeSection>
					<NativeTextRow
						icon={{ sf: "video.slash", lucide: CameraOff }}
						text={
							refused
								? "**Night Shift cannot use the camera**"
								: "**Allow the camera to scan the code**"
						}
						note={
							refused
								? "Allow the camera for Night Shift in the Settings app of your phone. Or type the Host address."
								: "Night Shift uses the camera only to read the code. It keeps no pictures."
						}
					/>
					<NativeButtonRow
						label={refused ? "Open Settings" : "Allow the camera"}
						onPress={() =>
							refused ? void Linking.openSettings() : void requestPermission()
						}
					/>
				</NativeSection>
				{typeInstead}
			</>
		);
	}

	return (
		<>
			<NativeSection footer={wrongCode === "none" ? WHERE : undefined}>
				<NativeCustomRow>
					<View className="aspect-square w-full overflow-hidden rounded-lg bg-muted">
						<CameraView
							style={{ flex: 1 }}
							facing="back"
							barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
							onBarcodeScanned={scanned}
						/>
					</View>
				</NativeCustomRow>
			</NativeSection>
			{wrongCode === "none" ? null : (
				<NativeSection>
					<NativeTextRow
						icon={{ sf: "exclamationmark.triangle.fill", lucide: CircleAlert }}
						iconColor={RED}
						text={
							wrongCode === "http"
								? "**This code has no https:// address**"
								: "**This code has no Host address**"
						}
						note={
							wrongCode === "http"
								? 'A Host needs an https:// address. Scan the code under Settings, "Use Night Shift on your phone".'
								: 'Scan the code under Settings, "Use Night Shift on your phone".'
						}
					/>
				</NativeSection>
			)}
			{typeInstead}
		</>
	);
}
