import React from "react";
import ReactDOM from "react-dom/client";

// IMPORTANT: your App is here:
import App from "./app/App";

import "./styles/index.css"; // keep if exists

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
