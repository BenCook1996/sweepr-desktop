import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

let spinAngle = 0;
function tickSpinners() {
  if (document.querySelector(".spinner")) {
    spinAngle = (spinAngle + 6) % 360;
    document.documentElement.style.setProperty("--sweepr-spin", `${spinAngle}deg`);
  }
  requestAnimationFrame(tickSpinners);
}
requestAnimationFrame(tickSpinners);

const app = mount(App, { target: document.getElementById("app")! });

export default app;

