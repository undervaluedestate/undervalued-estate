import { getAdminClient } from '../../utils/supabase';
import { makeTransport } from '../email/transport';
function buildQueryForAlert(supa, alert) {
    let q = supa.from('v_search_results').select('*');
    q = q.eq('country', alert.country);
    if (alert.state)
        q = q.eq('state', alert.state);
    if (alert.city)
        q = q.eq('city', alert.city);
    if (alert.neighborhood)
        q = q.eq('neighborhood', alert.neighborhood);
    if (alert.property_type)
        q = q.eq('property_type', alert.property_type);
    if (alert.min_price != null)
        q = q.gte('price', alert.min_price);
    if (alert.max_price != null)
        q = q.lte('price', alert.max_price);
    if (alert.min_size_sqm != null)
        q = q.gte('size_sqm', alert.min_size_sqm);
    if (alert.max_size_sqm != null)
        q = q.lte('size_sqm', alert.max_size_sqm);
    const threshold = Number(alert.threshold_percent) || 0;
    if (threshold > 0)
        q = q.lte('pct_vs_market', -Math.abs(threshold));
    q = q.order('scraped_at', { ascending: false }).limit(200);
    return q;
}
export async function dispatchAlerts({ maxPerAlert = 20 } = {}) {
    const supa = getAdminClient();
    const transport = makeTransport();
    const { data: alerts, error: aerr } = await supa
        .from('alerts')
        .select('*')
        .eq('is_active', true)
        .limit(1000);
    if (aerr)
        throw aerr;
    let sent = 0;
    const errors = [];
    for (const alert of alerts || []) {
        try {
            const { data: props, error: perr } = await buildQueryForAlert(supa, alert).limit(maxPerAlert);
            if (perr)
                throw perr;
            if (!props || props.length === 0)
                continue;
            for (const p of props) {
                const { data: existing, error: nerr } = await supa
                    .from('notifications')
                    .select('id')
                    .eq('alert_id', alert.id)
                    .eq('property_id', p.id)
                    .maybeSingle();
                if (nerr)
                    throw nerr;
                if (existing)
                    continue;
                const subject = `[Undervalued Estate] Potential deal: ${p.title || p.city || p.url}`;
                const body = `Property: ${p.title || 'Listing'}\n` +
                    `URL: ${p.url}\n` +
                    `Price: ${p.currency} ${p.price}\n` +
                    `Size: ${p.size_sqm || 'N/A'} sqm\n` +
                    `Price/sqm: ${p.price_per_sqm || 'N/A'}\n` +
                    `Market avg/sqm: ${p.market_avg_price_per_sqm || 'N/A'}\n` +
                    `% vs market: ${p.pct_vs_market || 'N/A'}\n` +
                    `Location: ${[p.neighborhood, p.city, p.state, p.country].filter(Boolean).join(', ')}`;
                try {
                    await transport.sendMail({
                        from: process.env.GMAIL_USER,
                        to: alert.email,
                        subject,
                        text: body,
                    });
                    const { error: insErr } = await supa.from('notifications').insert({
                        alert_id: alert.id,
                        property_id: p.id,
                        status: 'sent',
                    });
                    if (insErr)
                        throw insErr;
                    sent++;
                }
                catch (mailErr) {
                    await supa.from('notifications').insert({
                        alert_id: alert.id,
                        property_id: p.id,
                        status: 'failed',
                        error: String(mailErr.message || mailErr),
                    });
                    errors.push(`email failed: ${mailErr.message || mailErr}`);
                }
            }
        }
        catch (e) {
            errors.push(`alert ${alert.id} failed: ${e.message}`);
        }
    }
    return { alerts: alerts?.length || 0, sent, errors };
}
