import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createQueryClient } from "@/shared/api";

import { getRouter } from "./router";
import "./index.css";

const queryClient = createQueryClient();
const router = getRouter();
const root = document.getElementById("root");
if (!root) throw new Error("The page has no root.");

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	</StrictMode>,
);
