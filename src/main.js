import "./style.css";
import { mountApp } from "./app.js";

const root = document.getElementById("app");
mountApp(root);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  const sw = `${import.meta.env.BASE_URL}sw.js`;
  navigator.serviceWorker.register(sw).then((reg) => {
    reg.update().catch(() => {});
  }).catch(() => {});
}
