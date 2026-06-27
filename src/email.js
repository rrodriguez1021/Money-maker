// Transactional email — pluggable and optional. With RESEND_API_KEY set, sign-in
// links are emailed via Resend's HTTP API (no SDK, just fetch). Without it, the link
// is logged to the server console so local/demo development still works end to end.
//
// This is deliberately tiny: the only thing the app emails today is a magic sign-in
// link. Swap in SMTP/SES here without touching the rest of the app.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.EMAIL_FROM || 'Qrysm <login@qrysm.app>';

export const emailEnabled = Boolean(RESEND_API_KEY);

// Send a passwordless sign-in link. Returns true if it was actually emailed,
// false if we only logged it (no provider configured).
export async function sendLoginLink(to, url) {
  if (!emailEnabled) {
    // Dev/demo fallback: surface the link where the operator can see it.
    console.log(`\n[email disabled] Sign-in link for ${to}:\n  ${url}\n`);
    return false;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to,
      subject: 'Your Qrysm sign-in link',
      text: `Sign in to Qrysm:\n\n${url}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`,
      html: `<p>Sign in to Qrysm:</p><p><a href="${url}">Sign in</a></p>`
        + `<p style="color:#888;font-size:13px">This link expires in 15 minutes. If you didn't request it, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`resend_failed ${res.status} ${detail}`);
  }
  return true;
}
