import { Router } from 'express';
import { getAdminClient } from '../utils/supabase';
import nodemailer from 'nodemailer';
const router = Router();
async function sendEmail(to, subject, html) {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = Number(process.env.SMTP_PORT || 465);
    const secure = String(process.env.SMTP_SECURE || (port === 465 ? '1' : '0')) === '1';
    // Prefer SMTP_* if present, else fallback to GMAIL_*
    const user = process.env.SMTP_USER || process.env.GMAIL_USER || '';
    const pass = process.env.SMTP_PASS || process.env.GMAIL_PASS || '';
    const from = process.env.SUPPORT_FROM_EMAIL || (user ? `${user}` : 'support@undervaluedestate.com');
    if (!user || !pass) {
        console.warn('[support:email] SMTP_USER/SMTP_PASS not set; skipping send');
        return { skipped: true };
    }
    const transporter = nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
    const info = await transporter.sendMail({ from, to, subject, html });
    return { id: info.messageId };
}
router.post('/notify', async (req, res) => {
    try {
        const { message_id } = req.body;
        if (!message_id)
            return res.status(400).json({ error: 'message_id required' });
        const supa = getAdminClient();
        const { data: msg, error: msgErr } = await supa.from('support_messages').select('*').eq('id', message_id).maybeSingle();
        if (msgErr || !msg)
            throw new Error(msgErr?.message || 'message not found');
        const { data: conv, error: convErr } = await supa.from('support_conversations').select('*').eq('id', msg.conversation_id).maybeSingle();
        if (convErr || !conv)
            throw new Error(convErr?.message || 'conversation not found');
        let recipients = [];
        let subject = '';
        let html = '';
        if (msg.from_role === 'user') {
            // Email admins
            const allow = String(process.env.ADMIN_EMAILS || '').split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
            recipients = allow;
            subject = 'New support message from user';
            html = `<div>
        <p>New message from user ${conv.user_id}</p>
        <p>${msg.body}</p>
        ${msg.property_snapshot ? `<pre style="background:#f6f8fa;padding:12px;border-radius:6px;">${JSON.stringify(msg.property_snapshot, null, 2)}</pre>` : ''}
      </div>`;
        }
        else if (msg.from_role === 'admin') {
            // Email the user
            const { data: userRes } = await supa.auth.admin.getUserById(conv.user_id);
            const email = userRes?.user?.email;
            if (email)
                recipients = [email];
            subject = 'New reply from Support';
            html = `<div>
        <p>We just replied to your support conversation:</p>
        <p>${msg.body}</p>
        ${msg.property_snapshot ? `<pre style="background:#f6f8fa;padding:12px;border-radius:6px;">${JSON.stringify(msg.property_snapshot, null, 2)}</pre>` : ''}
      </div>`;
        }
        if (recipients.length)
            await sendEmail(recipients, subject, html);
        res.json({ ok: true, recipients });
    }
    catch (err) {
        console.error('[support:notify] error', err);
        res.status(500).json({ error: err?.message || 'Failed to notify' });
    }
});
export default router;
