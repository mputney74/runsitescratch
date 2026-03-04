import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./RunSiteScratch_Platform.jsx";

// Global reset — Platform.jsx uses inline styles throughout,
// but we zero out browser defaults here to prevent layout bleed.
const style = document.createElement("style");
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
  /* Prevent iOS tap highlight on buttons */
  button { -webkit-tap-highlight-color: transparent; }
  /* Stripe iframe z-index safety */
  .stripe-iframe { z-index: 9999 !important; }
`;
document.head.appendChild(style);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
