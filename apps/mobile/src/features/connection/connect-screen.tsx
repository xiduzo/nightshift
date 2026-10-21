import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@nightshift/ui-native/components/ui/alert";
import { Button } from "@nightshift/ui-native/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@nightshift/ui-native/components/ui/card";
import { Input } from "@nightshift/ui-native/components/ui/input";
import { Label } from "@nightshift/ui-native/components/ui/label";
import { Text } from "@nightshift/ui-native/components/ui/text";
import { router } from "expo-router";
import { CircleAlert } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { ENV } from "@/env";
import { Screen } from "@/shared/page";
import { useConnection } from "./connection-provider";

type Step = "sign-in" | "code";

/**
 * Connect this phone to a Host: its address, the person's email and
 * password, and a two-factor code when the Host asks for one.
 */
export function ConnectScreen() {
	const { connection, signIn, verifyCode } = useConnection();
	const [step, setStep] = useState<Step>("sign-in");
	const [address, setAddress] = useState(
		(connection.status === "signed-out" && connection.address) ||
			ENV.EXPO_PUBLIC_DEFAULT_HOST ||
			"",
	);
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit() {
		setBusy(true);
		setError(null);
		try {
			if (step === "sign-in") {
				const result = await signIn({ address, email, password });
				if (result === "needs-code") {
					setStep("code");
					return;
				}
			} else {
				await verifyCode(code);
			}
			router.replace("/");
		} catch (failed) {
			setError(failed instanceof Error ? failed.message : String(failed));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Screen>
			<Card>
				<CardHeader>
					<CardTitle>Connect to your Host</CardTitle>
					<CardDescription>
						Sign in to the Host that runs your flows. Then you answer Gates and
						follow runs from this phone.
					</CardDescription>
				</CardHeader>
				<CardContent className="gap-4">
					{step === "sign-in" ? (
						<>
							<Field
								label="Host address"
								hint="The address where you open Night Shift in a browser."
							>
								<Input
									value={address}
									onChangeText={setAddress}
									placeholder="nightshift.example.com"
									autoCapitalize="none"
									autoCorrect={false}
									keyboardType="url"
									textContentType="URL"
								/>
							</Field>
							<Field label="Email">
								<Input
									value={email}
									onChangeText={setEmail}
									placeholder="you@example.com"
									autoCapitalize="none"
									autoComplete="email"
									keyboardType="email-address"
									textContentType="emailAddress"
								/>
							</Field>
							<Field label="Password">
								<Input
									value={password}
									onChangeText={setPassword}
									secureTextEntry
									autoComplete="password"
									textContentType="password"
									onSubmitEditing={submit}
								/>
							</Field>
						</>
					) : (
						<Field
							label="Two-factor code"
							hint="Enter the 6-digit code from your authenticator app, or a backup code."
						>
							<Input
								value={code}
								onChangeText={setCode}
								placeholder="123456"
								autoCapitalize="none"
								autoComplete="one-time-code"
								keyboardType="number-pad"
								textContentType="oneTimeCode"
								onSubmitEditing={submit}
							/>
						</Field>
					)}
					{error ? (
						<Alert icon={CircleAlert} variant="destructive">
							<AlertTitle>You are not connected</AlertTitle>
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					) : null}
					<Button onPress={submit} disabled={busy}>
						<Text>
							{step === "sign-in"
								? busy
									? "Connecting…"
									: "Connect"
								: busy
									? "Checking the code…"
									: "Verify code"}
						</Text>
					</Button>
				</CardContent>
			</Card>
		</Screen>
	);
}

/** A label, its control and an optional hint: the shadcn Field, in parts. */
function Field({
	label,
	hint,
	children,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
}) {
	return (
		<View className="gap-2">
			<Label>{label}</Label>
			{children}
			{hint ? <Text variant="muted">{hint}</Text> : null}
		</View>
	);
}
