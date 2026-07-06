// Vercel serverless function — start a JazzCash "Page Redirection" (hosted checkout) payment.
//
// The browser POSTs { order_id, amount } here. We build the signed pp_* field set that
// JazzCash's hosted checkout form expects and return it as JSON. The browser then auto-
// submits those fields as a hidden <form> to JazzCash's sandbox merchant URL, which takes
// the customer to the gateway. When the customer finishes, JazzCash redirects them (and
// POSTs the result) to pp_ReturnURL → our /api/jazzcash-callback.
//
// Runs SERVER-SIDE, so all credentials come from environment variables (never hardcoded):
//   JAZZCASH_MERCHANT_ID, JAZZCASH_PASSWORD, JAZZCASH_INTEGRITY_SALT
//   JAZZCASH_RETURN_URL   (optional; defaults to the live deployment's callback)
//
// pp_SecureHash algorithm (JazzCash HMAC-SHA256 hosted-checkout scheme):
//   1. Take every pp_* field EXCEPT pp_SecureHash whose value is non-empty.
//   2. Sort those fields alphabetically by key name.
//   3. Join their VALUES with '&', and prepend the Integrity Salt:
//        salt&value1&value2&...&valueN
//   4. HMAC-SHA256 that string, keyed with the SAME Integrity Salt → lowercase hex.
//   (Verify once against your sandbox "Hash Calculator"; casing/version can vary per account.)

import crypto from 'node:crypto';

/**
 * Compute the JazzCash pp_SecureHash for a set of fields.
 * @param {Record<string, string>} fields
 * @param {string} integritySalt
 * @returns {string} lowercase hex HMAC-SHA256
 */
function computeSecureHash(fields, integritySalt) {
    const sortedKeys = Object.keys(fields).sort();
    let toBeHashed = integritySalt;
    for (const key of sortedKeys) {
        if (key === 'pp_SecureHash') continue;
        const value = fields[key];
        if (value !== undefined && value !== null && String(value).length > 0) {
            toBeHashed += '&' + value;
        }
    }
    return crypto.createHmac('sha256', integritySalt).update(toBeHashed).digest('hex');
}

/**
 * Format a Date as JazzCash's yyyyMMddHHmmss, in Pakistan Standard Time (UTC+5).
 * Vercel runs in UTC, and JazzCash validates the timestamps against PKT — so we must
 * shift, otherwise the transaction looks 5 hours old and the expiry is already past.
 * @param {Date} date
 * @returns {string}
 */
function formatPKT(date) {
    const pkt = new Date(date.getTime() + 5 * 60 * 60 * 1000);
    const p = n => String(n).padStart(2, '0');
    return `${pkt.getUTCFullYear()}${p(pkt.getUTCMonth() + 1)}${p(pkt.getUTCDate())}` +
           `${p(pkt.getUTCHours())}${p(pkt.getUTCMinutes())}${p(pkt.getUTCSeconds())}`;
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Credentials from env only. Trim defensively — the values were pasted with stray
    // leading spaces in .env.local, and a space would corrupt both the hash and the login.
    const MERCHANT_ID = (process.env.JAZZCASH_MERCHANT_ID || '').trim();
    const PASSWORD = (process.env.JAZZCASH_PASSWORD || '').trim();
    const INTEGRITY_SALT = (process.env.JAZZCASH_INTEGRITY_SALT || '').trim();
    // The customer is returned here after paying. MUST be a publicly reachable URL on the
    // LIVE deployment — the JazzCash gateway calls it, so localhost won't work. Defaults to
    // the confirmed-working "-nu" domain; override with JAZZCASH_RETURN_URL if you add a
    // custom domain. (Note: plain brewed-awakening.vercel.app currently 404s.)
    const RETURN_URL = (process.env.JAZZCASH_RETURN_URL ||
        'https://brewed-awakening-nu.vercel.app/api/jazzcash-callback').trim();

    if (!MERCHANT_ID || !PASSWORD || !INTEGRITY_SALT) {
        console.error('JazzCash initiate: missing credentials in environment.');
        return res.status(500).json({ error: 'JazzCash is not configured.' });
    }

    const { order_id, amount } = req.body || {};
    const amountNum = Number(amount);
    if (order_id === undefined || order_id === null || String(order_id).length === 0 ||
        !Number.isFinite(amountNum) || amountNum <= 0) {
        return res.status(400).json({ error: 'A valid order_id and positive amount are required.' });
    }

    const now = new Date();
    const txnDateTime = formatPKT(now);
    const txnExpiry = formatPKT(new Date(now.getTime() + 5 * 60 * 1000)); // +5 minutes

    // Unique transaction reference. "T" + timestamp, plus the order id to avoid collisions
    // if two customers check out in the same second.
    const txnRefNo = `T${txnDateTime}${String(order_id)}`;

    // The order id travels in pp_BillReference; the callback reads it back to know which
    // order to mark paid. Kept purely numeric-friendly ("order-19") so the callback's
    // digit-stripping recovers it.
    const billReference = `order${order_id}`;

    // Amount is in the smallest currency unit (paisa) — Rs 1.00 → "100".
    const amountInPaisa = String(Math.round(amountNum * 100));

    // Field set for JazzCash Page Redirection v1.1. pp_TxnType is intentionally empty for
    // hosted checkout (and, being empty, is excluded from the hash).
    const fields = {
        pp_Version: '1.1',
        pp_TxnType: '',
        pp_Language: 'EN',
        pp_MerchantID: MERCHANT_ID,
        pp_Password: PASSWORD,
        pp_TxnRefNo: txnRefNo,
        pp_Amount: amountInPaisa,
        pp_TxnCurrency: 'PKR',
        pp_TxnDateTime: txnDateTime,
        pp_TxnExpiryDateTime: txnExpiry,
        pp_BillReference: billReference,
        pp_Description: `Brewed Awakening order ${order_id}`,
        pp_ReturnURL: RETURN_URL,
    };

    fields.pp_SecureHash = computeSecureHash(fields, INTEGRITY_SALT);

    // The browser POSTs these fields to this hosted-checkout URL.
    return res.status(200).json({
        action: 'https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/',
        fields,
    });
}
