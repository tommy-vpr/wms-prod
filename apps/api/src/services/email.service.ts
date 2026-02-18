import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const FROM_EMAIL = process.env.FROM_EMAIL || "noreply@hq.team";
const APP_URL =
  process.env.APP_URL ||
  (process.env.NODE_ENV === "production"
    ? "https://app.hq.team"
    : "http://localhost:5173");

export async function sendPasswordResetEmail(
  email: string,
  token: string,
  userName?: string | null,
): Promise<boolean> {
  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  // Always log in dev for debugging
  if (process.env.NODE_ENV !== "production") {
    console.log("📧 [DEV] Password reset email:");
    console.log(`   To: ${email}`);
    console.log(`   Link: ${resetUrl}`);
  }

  // Send real email if Resend is configured
  if (!resend) {
    return true;
  }

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: "Reset Your Password - WMS",
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: #f8f9fa; border-radius: 8px; padding: 32px; margin-bottom: 24px;">
            <h1 style="margin: 0 0 16px; color: #111; font-size: 24px;">Reset Your Password</h1>
            <p style="margin: 0 0 24px; color: #666;">
              Hi${userName ? ` ${userName}` : ""},
            </p>
            <p style="margin: 0 0 24px; color: #666;">
              We received a request to reset your password. Click the button below to create a new password:
            </p>
            <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">
              Reset Password
            </a>
            <p style="margin: 24px 0 0; color: #999; font-size: 14px;">
              This link will expire in 1 hour. If you didn't request this, you can safely ignore this email.
            </p>
          </div>
          <p style="color: #999; font-size: 12px; text-align: center;">
            If the button doesn't work, copy and paste this link:<br>
            <a href="${resetUrl}" style="color: #2563eb;">${resetUrl}</a>
          </p>
        </body>
        </html>
      `,
    });

    return true;
  } catch (error) {
    console.error("Failed to send password reset email:", error);
    return false;
  }
}
