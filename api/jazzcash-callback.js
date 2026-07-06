// Vercel serverless function — JazzCash payment callback (server-to-server + browser redirect)
//
// JazzCash POSTs the transaction result here (application/x-www-form-urlencoded).
// We verify the secure hash, update the matching order in Supabase, then redirect
// the customer's browser to a friendly status page.
//
// Runs SERVER-SIDE, so it reads secrets from environment variables (never hardcoded).
// Configure these in Vercel → Project → Settings → Environment Variables:
//   SUPABASE_URL, SUPABASE_ANON_KEY, JAZZCASH_INTEGRITY_SALT (+ merchant id/password later)

import crypto from 'node:crypto';

/**
 * Verify the JazzCash secure hash. Same scheme used to sign the initiate request:
 *   1. Take every field EXCEPT pp_SecureHash whose value is non-empty.
 *   2. Sort alphabetically by key name.
 *   3. Join their VALUES with '&', prepended by the Integrity Salt.
 *   4. HMAC-SHA256 that string, keyed with the SAME Integrity Salt.
 * Compare (case-insensitive, constant-time) against the received pp_SecureHash.
 *
 * @param {Record<string, string>} data - the posted fields
 * @param {string} integritySalt - JAZZCASH_INTEGRITY_SALT
 * @returns {boolean}
 */
function verifySecureHash(data, integritySalt) {
    if (!integritySalt) return false;
    const received = String(data.pp_SecureHash || '');
    if (!received) return false;

    let toBeHashed = integritySalt;
    for (const key of Object.keys(data).sort()) {
        if (key === 'pp_SecureHash') continue;
        const value = data[key];
        if (value !== undefined && value !== null && String(value).length > 0) {
            toBeHashed += '&' + value;
        }
    }
    const expected = crypto.createHmac('sha256', integritySalt).update(toBeHashed).digest('hex');

    // Constant-time, case-insensitive comparison.
    const a = Buffer.from(expected.toLowerCase(), 'utf8');
    const b = Buffer.from(received.toLowerCase(), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Derive our internal order id from the JazzCash bill reference.
 * Orders are referenced as "BA-0001", so we strip everything but the digits.
 * @param {string} billReference
 * @returns {number|null}
 */
function orderIdFromBillReference(billReference) {
    if (!billReference) return null;
    const digits = String(billReference).replace(/\D/g, '');
    if (!digits) return null;
    const id = parseInt(digits, 10);
    return Number.isFinite(id) ? id : null;
}

export default async function handler(req, res) {
    // JazzCash calls this endpoint with a POST.
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).send('Method Not Allowed');
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
    const JAZZCASH_INTEGRITY_SALT = (process.env.JAZZCASH_INTEGRITY_SALT || '').trim();

    // Vercel parses x-www-form-urlencoded / JSON bodies into req.body automatically.
    const body = req.body || {};
    const {
        pp_ResponseCode,
        pp_TxnRefNo,
        pp_Amount,
        pp_ResponseMessage,
        pp_SecureHash,
        pp_BillReference,
    } = body;

    // 1. Verify the hash before trusting anything in the payload.
    if (!verifySecureHash(body, JAZZCASH_INTEGRITY_SALT)) {
        console.error('JazzCash callback: secure hash verification failed', { pp_TxnRefNo, pp_BillReference });
        return res.redirect(303, '/payment-callback.html?status=failed');
    }

    // 2. A response code of "000" means the payment succeeded.
    const isSuccess = pp_ResponseCode === '000';
    const paymentStatus = isSuccess ? 'paid' : 'failed';

    // Determine the matched order's id. Our order id is encoded in pp_BillReference
    // when we initiate the payment (falling back to the transaction ref if needed).
    const orderId = orderIdFromBillReference(pp_BillReference);

    // 3. Update the matching order via the mark_order_payment RPC.
    //    We go through a SECURITY DEFINER function rather than PATCHing the orders
    //    table directly, because the public anon key can only call approved RPCs — it
    //    has no direct write access to the orders table (same model as place_order).
    //
    //    This fetch is the transport-level equivalent of:
    //        supabase.rpc('mark_order_payment', {
    //            p_order_id: orderId, p_status: paymentStatus, p_txn_ref: pp_TxnRefNo
    //        })
    try {
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            throw new Error('Supabase environment variables are not configured.');
        }
        if (orderId === null) {
            throw new Error(`Could not determine order id from bill reference "${pp_BillReference}"`);
        }

        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_order_payment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({
                p_order_id: orderId,
                p_status: paymentStatus,
                p_txn_ref: pp_TxnRefNo || null,
            }),
        });

        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`mark_order_payment RPC failed (${response.status}): ${detail}`);
        }
    } catch (error) {
        // Log for debugging, but still send the customer to a status page so they
        // aren't left on a blank POST response. Treat an update failure as "failed".
        console.error('JazzCash callback: failed to update order', {
            orderId,
            pp_TxnRefNo,
            pp_Amount,
            pp_ResponseMessage,
            error: error?.message,
        });
        return res.redirect(303, '/payment-callback.html?status=failed');
    }

    // 4. Redirect the browser to the friendly status page.
    return res.redirect(303, `/payment-callback.html?status=${isSuccess ? 'success' : 'failed'}`);
}
