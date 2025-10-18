import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

function getArg(name: string, alias?: string): string | undefined {
  const i = process.argv.findIndex(a => a === `--${name}` || (alias && a === alias));
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  const kv = process.argv.find(a => a.startsWith(`--${name}=`));
  if (kv) return kv.split('=')[1];
  return undefined;
}

function getFlag(name: string, alias?: string): boolean {
  return process.argv.some(a => a === `--${name}` || (alias && a === alias));
}

function mask(value?: string | null): string {
  if (!value) return '';
  if (value.length <= 4) return '*'.repeat(value.length);
  return value.slice(0, 2) + '***' + value.slice(-2);
}

function hintForError(err: any): string[] {
  const tips: string[] = [];
  const msg = String(err?.message || '').toLowerCase();
  const code = String(err?.code || '').toUpperCase();
  const response = String((err as any)?.response || '').toLowerCase();

  if (code === 'EAUTH' || msg.includes('invalid login')) {
    tips.push('SMTP auth failed. Verify SMTP_USER/SMTP_PASS (or GMAIL_USER/GMAIL_PASS for Gmail App Password).');
    tips.push('If using Gmail, ensure 2FA App Password is used and IMAP/SMTP is enabled.');
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || msg.includes('getaddrinfo')) {
    tips.push('DNS resolution failed. Check SMTP_HOST and your network DNS.');
  }
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || msg.includes('timeout')) {
    tips.push('Connection failed/timeout. Verify SMTP_PORT is open and not blocked by firewall.');
    tips.push('Common ports: 465 (secure), 587 (STARTTLS). Ensure SMTP_SECURE matches the port.');
  }
  if (msg.includes('self signed certificate')) {
    tips.push('TLS certificate validation failed. Use a trusted certificate or ensure SMTP_SECURE/port are correct.');
  }
  if (response.includes('quota') || response.includes('rate')) {
    tips.push('Provider quota/rate limit reached. Wait or reduce send frequency.');
  }
  if (tips.length === 0) tips.push('Enable verbose logging or check SMTP provider dashboard for more details.');
  return tips;
}

async function main() {
  const toArg = getArg('to', '-t');
  const subject = getArg('subject', '-s') || 'Undervalued Estate: SMTP Test Email';
  const text = getArg('text') || 'Hello! This is a test email from the server CLI.';
  const html = getArg('html') || `<p>Hello! This is a <strong>test email</strong> from the server CLI.</p>`;
  const host = getArg('host') || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(getArg('port') || process.env.SMTP_PORT || 465);
  const secure = String(getArg('secure') || process.env.SMTP_SECURE || (port === 465 ? '1' : '0')) === '1';
  const user = getArg('user') || process.env.SMTP_USER || process.env.GMAIL_USER || '';
  const pass = getArg('pass') || process.env.SMTP_PASS || process.env.GMAIL_PASS || '';
  const from = getArg('from') || process.env.SUPPORT_FROM_EMAIL || (user ? `${user}` : 'support@undervaluedestate.com');

  if (!toArg) {
    console.error('Usage: npm run email:test -- --to someone@example.com [--subject "..."] [--text "..."]');
    process.exit(2);
  }
  const to = toArg.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);

  console.log('SMTP config:');
  console.log(' host=', host);
  console.log(' port=', port, ' secure=', secure);
  console.log(' user=', user ? mask(user) : '(empty)');
  console.log(' pass=', pass ? mask(pass) : '(empty)');
  console.log(' from=', from);
  console.log(' to  =', to.join(', '));

  if (!user || !pass) {
    console.error('\nError: Missing SMTP credentials. Set SMTP_USER/SMTP_PASS (or GMAIL_USER/GMAIL_PASS).');
    process.exit(1);
  }

  try {
    const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });

    console.log('\nVerifying connection...');
    await transporter.verify();
    console.log('SMTP verification: OK');

    console.log('\nSending email...');
    const info = await transporter.sendMail({ from, to, subject, text, html });
    console.log('Email sent. messageId=', info.messageId);
    process.exit(0);
  } catch (err: any) {
    console.error('\nFailed to send email.');
    console.error(' Error code   :', err?.code || '(none)');
    console.error(' Error message:', err?.message || '(no message)');
    if (err?.command) console.error(' SMTP command :', err.command);
    if (err?.response) console.error(' SMTP response:', err.response);
    const tips = hintForError(err);
    if (tips.length) {
      console.error('\nSuggestions:');
      for (const t of tips) console.error(' -', t);
    }
    process.exit(1);
  }
}

main().catch((e) => { console.error('Unexpected error:', e); process.exit(1); });
