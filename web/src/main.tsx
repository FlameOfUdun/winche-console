import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { SessionProvider } from "./auth/session";
import { firebaseTheme } from "./theme";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/dropzone/styles.css";

const queryClient = new QueryClient();
const basename = new URL(document.baseURI).pathname.replace(/\/$/, "");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MantineProvider theme={firebaseTheme}>
      <Notifications />
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <BrowserRouter basename={basename}>
            <App />
          </BrowserRouter>
        </SessionProvider>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
);
