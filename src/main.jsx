import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./RunSiteScratch_Platform.jsx";

const style = document.createElement("style");
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  button { -webkit-tap-highlight-color: transparent; }
  .stripe-iframe { z-index: 9999 !important; }
`;
document.head.appendChild(style);

const MAINTENANCE = import.meta.env.VITE_MAINTENANCE === "true";

const ComingSoon = () => (
  <div style={{ fontFamily: "'Georgia', serif", background: "#0a0a0f", color: "#d4a853", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "2rem" }}>
    <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.2em", color: "#666", marginBottom: 24 }}>RUNSITESCRATCH.COM</div>
    <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: 400, letterSpacing: "-0.02em", marginBottom: 16, color: "#fff" }}>Coming Soon</h1>
    <p style={{ fontSize: 15, color: "#555", maxWidth: 360, lineHeight: 1.7 }}>AI-powered revenue projections for fuel & convenience retail. Launching shortly.</p>
  </div>
);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    {MAINTENANCE ? <ComingSoon /> : <App />}
  </StrictMode>
);
