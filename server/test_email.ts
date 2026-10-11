import { sendSubscriptionEmail } from "./src/email.js";
import { config } from "dotenv";
config();

async function test() {
  console.log("Testing email to cookbenjamin1996@gmail.com...");
  await sendSubscriptionEmail("cookbenjamin1996@gmail.com", "otp", "123456");
  console.log("Test complete.");
}

test();
