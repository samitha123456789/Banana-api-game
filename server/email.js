const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD;
const SMTP_FROM_EMAIL = process.env.SMTP_FROM_EMAIL || SMTP_USER;

const BRAND_YELLOW = '#E6B800';
const BRAND_YELLOW_DARK = '#B38F00';
const BG_DARK = '#0d0f14';
const TEXT_LIGHT = '#e8eaef';
const TEXT_MUTED = '#8b92a3';

let transporter = null;

function getTransporter() {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASSWORD) {
    return null;
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASSWORD
      }
    });
  }
  return transporter;
}

/**
 * Build professional game-platform OTP email (no links).
 * @param {string} otp - 6-digit code
 * @param {'signup'|'password_reset'} type
 * @returns {{ subject: string, text: string, html: string }}
 */
function buildGameOTPEmail(otp, type) {
  const isSignup = type === 'signup';
  const subject = isSignup
    ? 'Your verification code – Banana Challenge Arena'
    : 'Password reset code – Banana Challenge Arena';
  const title = isSignup ? 'Verify your account' : 'Reset your password';
  const intro = isSignup
    ? 'Use this code to complete your Banana Challenge Arena signup. Enter it in the app to create your account.'
    : 'Use this code to reset your Banana Challenge Arena password. Enter it on the reset page with your new password.';
  const ctaLabel = isSignup ? 'Your verification code' : 'Your reset code';

  const text = [
    `Banana Challenge Arena – ${title}`,
    '',
    intro,
    '',
    `${ctaLabel}: ${otp}`,
    '',
    'This code expires in 10 minutes. Do not share it with anyone.',
    'If you did not request this, you can safely ignore this email.',
    '',
    '— Banana Challenge Arena Team'
  ].join('\n');

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0; padding:0; background-color:#0d0f14; font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif; -webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:${BG_DARK}; min-height:100vh;">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:480px; background-color:#151922; border-radius:16px; border:1px solid rgba(230,184,0,0.2); overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 24px; text-align:center; border-bottom:1px solid rgba(230,184,0,0.15);">
              <p style="margin:0 0 8px; font-size:32px;">🍌</p>
              <h1 style="margin:0; font-size:24px; font-weight:700; color:${BRAND_YELLOW}; letter-spacing:-0.02em;">Banana Challenge Arena</h1>
              <p style="margin:8px 0 0; font-size:14px; color:${TEXT_MUTED};">Play smart. Score big.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px; font-size:18px; font-weight:600; color:${TEXT_LIGHT};">${title}</h2>
              <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:${TEXT_MUTED};">${intro}</p>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:20px; background-color:rgba(230,184,0,0.08); border:2px solid ${BRAND_YELLOW}; border-radius:12px;">
                    <p style="margin:0 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:0.08em; color:${TEXT_MUTED};">${ctaLabel}</p>
                    <p style="margin:0; font-size:28px; font-weight:800; letter-spacing:0.2em; color:${BRAND_YELLOW}; font-variant-numeric:tabular-nums;">${otp}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0; font-size:13px; line-height:1.5; color:${TEXT_MUTED};">This code expires in 10 minutes. Do not share it with anyone.</p>
              <p style="margin:12px 0 0; font-size:13px; color:${TEXT_MUTED};">If you did not request this, you can safely ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px; text-align:center; border-top:1px solid rgba(230,184,0,0.1);">
              <p style="margin:0; font-size:12px; color:${TEXT_MUTED};">— Banana Challenge Arena Team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

/**
 * Send an email. Returns true if sent, false if email not configured or send failed.
 * @param {string} to - Recipient email
 * @param {string} subject - Subject line
 * @param {string} text - Plain text body
 * @param {string} [html] - Optional HTML body
 */
async function sendEmail(to, subject, text, html) {
  const trans = getTransporter();
  if (!trans) {
    console.warn('Email not configured: set SMTP_HOST, SMTP_USER, SMTP_PASSWORD in .env');
    return false;
  }
  try {
    await trans.sendMail({
      from: SMTP_FROM_EMAIL || SMTP_USER,
      to,
      subject,
      text: text || (html ? html.replace(/<[^>]+>/g, ' ') : ''),
      html: html || undefined
    });
    return true;
  } catch (err) {
    console.error('Send email failed:', err);
    return false;
  }
}

module.exports = {
  sendEmail,
  buildGameOTPEmail,
  isConfigured: () => !!(SMTP_HOST && SMTP_USER && SMTP_PASSWORD)
};
