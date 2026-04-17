// src/services/email.js
// Transactional email via Resend (https://resend.com)
// Free tier: 3,000 emails/month — sufficient for beta
const logger = require('../utils/logger');

const BASE_URL = process.env.APP_URL || 'https://rendezvous.app';
const FROM     = process.env.EMAIL_FROM || 'Rendezvous <hello@rendezvous.app>';

// ── RESEND CLIENT ─────────────────────────────────────────────────────
let resend;
function getResend() {
  if (!resend) {
    const { Resend } = require('resend');
    resend = new Resend(process.env.RESEND_API_KEY);
  }
  return resend;
}

// ── EMAIL TEMPLATES ───────────────────────────────────────────────────
function verificationTemplate(displayName, verifyUrl) {
  return {
    subject: 'Verify your Rendezvous account',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0e0c;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0e0c;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1814;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
        <tr><td style="padding:32px 40px;text-align:center;background:#1a1814;">
          <div style="font-size:32px;font-weight:800;color:#E8A135;letter-spacing:-0.02em;">✦ Rendezvous</div>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <h1 style="color:#f5f0e8;font-size:22px;font-weight:700;margin:0 0 12px;">Hey ${displayName}, you're almost in.</h1>
          <p style="color:#cec8bc;font-size:15px;line-height:1.6;margin:0 0 28px;">Click the button below to verify your email address and activate your account.</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="${verifyUrl}" style="display:inline-block;background:#E8A135;color:#1A1410;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:50px;letter-spacing:0.02em;">Verify my email →</a>
            </td></tr>
          </table>
          <p style="color:#7a7060;font-size:13px;line-height:1.6;margin:24px 0 0;text-align:center;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.06);">
          <p style="color:#4e4840;font-size:12px;text-align:center;margin:0;">© 2025 Rendezvous · Making plans. Making memories.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

function passwordResetTemplate(displayName, resetUrl) {
  return {
    subject: 'Reset your Rendezvous password',
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0f0e0c;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0e0c;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1814;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
        <tr><td style="padding:32px 40px;text-align:center;">
          <div style="font-size:32px;font-weight:800;color:#E8A135;">✦ Rendezvous</div>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <h1 style="color:#f5f0e8;font-size:22px;font-weight:700;margin:0 0 12px;">Password reset requested</h1>
          <p style="color:#cec8bc;font-size:15px;line-height:1.6;margin:0 0 28px;">Hey ${displayName}, we received a request to reset your password. Click below to choose a new one.</p>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center">
              <a href="${resetUrl}" style="display:inline-block;background:#E8A135;color:#1A1410;font-size:15px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:50px;">Reset my password →</a>
            </td></tr>
          </table>
          <p style="color:#7a7060;font-size:13px;line-height:1.6;margin:24px 0 0;text-align:center;">This link expires in 1 hour. If you didn't request this, your account is safe — you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

function welcomeTemplate(displayName) {
  return {
    subject: `Welcome to Rendezvous, ${displayName} ✦`,
    html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0f0e0c;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0e0c;padding:40px 20px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#1a1814;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
        <tr><td style="padding:40px 40px 32px;text-align:center;">
          <div style="font-size:48px;margin-bottom:12px;">✦</div>
          <div style="font-size:32px;font-weight:800;color:#E8A135;">You're in.</div>
        </td></tr>
        <tr><td style="padding:0 40px 40px;">
          <p style="color:#f5f0e8;font-size:18px;font-weight:600;margin:0 0 12px;">Welcome, ${displayName}.</p>
          <p style="color:#cec8bc;font-size:15px;line-height:1.6;margin:0 0 20px;">Your taste profile is ready. Connect Spotify or Instagram to help Rendezvous understand your vibe — the more you share, the better your plans get.</p>
          <p style="color:#cec8bc;font-size:15px;line-height:1.6;margin:0;">Start a Party, add your friends, and let Rendezvous figure out where to go tonight.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

// ── SEND FUNCTIONS ────────────────────────────────────────────────────
async function sendVerificationEmail(user, token) {
  const verifyUrl = `${BASE_URL}/verify-email?token=${token}`;
  const tmpl = verificationTemplate(user.displayName, verifyUrl);
  return send(user.email, tmpl.subject, tmpl.html);
}

async function sendPasswordResetEmail(user, token) {
  const resetUrl = `${BASE_URL}/reset-password?token=${token}`;
  const tmpl = passwordResetTemplate(user.displayName, resetUrl);
  return send(user.email, tmpl.subject, tmpl.html);
}

async function sendWelcomeEmail(user) {
  const tmpl = welcomeTemplate(user.displayName);
  return send(user.email, tmpl.subject, tmpl.html);
}

async function send(to, subject, html) {
  if (!process.env.RESEND_API_KEY) {
    logger.warn(`Email not sent to ${to} — RESEND_API_KEY not configured`);
    return null;
  }
  try {
    const result = await getResend().emails.send({ from: FROM, to, subject, html });
    logger.info(`Email sent to ${to}: ${subject}`);
    return result;
  } catch (err) {
    logger.error(`Email send failed to ${to}: ${err.message}`);
    throw err;
  }
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail };
