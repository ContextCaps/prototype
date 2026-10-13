import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/bold";
import "@phosphor-icons/web/fill";
import "./styles.css";
import { App } from "./App";
import { WalletProvider } from "./lib/WalletProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletProvider><App /></WalletProvider>
  </StrictMode>,
);
