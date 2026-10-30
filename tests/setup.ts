import dotenv from "dotenv";
import path from "path";

const explicitAuthSecret = process.env.AUTH_SECRET;
dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: true });

if (explicitAuthSecret) {
  process.env.AUTH_SECRET = explicitAuthSecret;
} else if (!process.env.AUTH_SECRET) {
  process.env.AUTH_SECRET = "test_auth_secret_for_integration_testing_habitt";
}

if (!process.env.CRON_SECRET) {
  process.env.CRON_SECRET = "test_cron_secret";
}

if (!process.env.RAZORPAY_WEBHOOK_SECRET) {
  process.env.RAZORPAY_WEBHOOK_SECRET = "test_webhook_secret";
}

// Safety check per prompt:
const rzpKey = process.env.RAZORPAY_KEY_ID || "";
if (!rzpKey.startsWith("rzp_test_")) {
  throw new Error(`SAFETY STOP: RAZORPAY_KEY_ID does not start with "rzp_test_"! Value was: ${rzpKey.substring(0, 9)}...`);
}
