import { createTransport } from "nodemailer";

const user = "cookbenjamin1996@gmail.com";
const pass = "cbty rkpl zpwh pbnj"; // with spaces

async function test() {
  try {
    const transporter = createTransport({
      service: "gmail",
      auth: { user, pass }
    });
    console.log("Verifying connection...");
    await transporter.verify();
    console.log("Connection verified!");
  } catch (err) {
    console.error("Verification failed:", err);
  }
}
test();
