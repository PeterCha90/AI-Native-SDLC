import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Console from "./Console.jsx";
import "./ops.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Console />
  </StrictMode>,
);
