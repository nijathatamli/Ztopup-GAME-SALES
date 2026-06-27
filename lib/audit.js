const crypto = require('crypto');

/**
 * Parse browser and OS from a User-Agent string.
 * Lightweight, no external dependencies.
 */
function parseUserAgent(ua = '') {
  const str = String(ua || '').toLowerCase();
  let browser = 'Unknown';
  let os = 'Unknown';

  if (str.includes('edg/')) browser = 'Edge';
  else if (str.includes('opr/') || str.includes('opera/')) browser = 'Opera';
  else if (str.includes('chrome/') || str.includes('crios/')) browser = 'Chrome';
  else if (str.includes('safari/') && str.includes('version/')) browser = 'Safari';
  else if (str.includes('firefox/') || str.includes('fxios/')) browser = 'Firefox';
  else if (str.includes('msie') || str.includes('trident/')) browser = 'IE';

  if (str.includes('windows')) os = 'Windows';
  else if (str.includes('macintosh') || str.includes('mac os')) os = 'macOS';
  else if (str.includes('linux')) os = 'Linux';
  else if (str.includes('android')) os = 'Android';
  else if (str.includes('iphone') || str.includes('ipad')) os = 'iOS';

  return { browser, os };
}

function extractClientIp(req) {
  if (!req) return null;
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : null;
}

/**
 * Persist an audit log entry to PostgreSQL and stdout.
 *
 * @param {object} pool - node-pg Pool
 * @param {object} params
 * @param {string} params.action - e.g. 'order_status_updated'
 * @param {object} params.admin - { id, username } (optional)
 * @param {string} params.targetType - e.g. 'order', 'user', 'product'
 * @param {string} params.targetId
 * @param {object} params.oldValue
 * @param {object} params.newValue
 * @param {object} params.req - HTTP request object
 * @param {object} params.meta - any additional fields merged into old_value/new_value
 */
async function auditLog(pool, params = {}) {
  if (!pool) {
    console.warn('[AUDIT] Pool not available, logging to stdout only');
    console.log('[AUDIT]', JSON.stringify({ ts: new Date().toISOString(), ...params }));
    return;
  }

  const {
    action,
    admin = null,
    targetType = null,
    targetId = null,
    oldValue = null,
    newValue = null,
    req = null,
    meta = null
  } = params;

  const ip = extractClientIp(req);
  const ua = req && req.headers ? String(req.headers['user-agent'] || '') : '';
  const { browser, os } = parseUserAgent(ua);

  const id = crypto.randomUUID();
  const finalOld = meta ? { ...(oldValue || {}), ...meta } : oldValue;
  const finalNew = meta ? { ...(newValue || {}), ...meta } : newValue;

  try {
    await pool.query(
      `INSERT INTO audit_logs (
        id, admin_id, admin_username, action, target_type, target_id,
        old_value, new_value, ip_address, user_agent, browser, os, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [
        id,
        admin ? String(admin.id || admin.sub || '') : null,
        admin ? String(admin.username || '') : null,
        String(action || 'unknown'),
        targetType ? String(targetType) : null,
        targetId ? String(targetId) : null,
        finalOld ? JSON.stringify(finalOld) : null,
        finalNew ? JSON.stringify(finalNew) : null,
        ip,
        ua || null,
        browser,
        os
      ]
    );
  } catch (err) {
    console.error('[AUDIT] DB insert failed:', err.message);
  }

  console.log('[AUDIT]', JSON.stringify({
    ts: new Date().toISOString(),
    action,
    adminId: admin ? admin.id || admin.sub : null,
    adminUsername: admin ? admin.username : null,
    targetType,
    targetId,
    ip,
    browser,
    os
  }));
}

module.exports = { auditLog, parseUserAgent, extractClientIp };
