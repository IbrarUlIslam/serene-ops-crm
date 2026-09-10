var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
function json(e, r = 200, t = {}) {
  return new Response(JSON.stringify(e), { status: r, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...t } });
}
__name(json, "json");
function errorResponse(e, r = 400, t = {}) {
  return json({ error: e, ...t }, r);
}
__name(errorResponse, "errorResponse");
function b64urlToUint8Array(e) {
  const r = e.replace(/-/g, "+").replace(/_/g, "/"), t = r + "===".slice((r.length + 3) % 4), s = atob(t), o = new Uint8Array(s.length);
  for (let e2 = 0; e2 < s.length; e2++) o[e2] = s.charCodeAt(e2);
  return o;
}
__name(b64urlToUint8Array, "b64urlToUint8Array");
function b64urlToJson(e) {
  const r = b64urlToUint8Array(e), t = new TextDecoder().decode(r);
  return JSON.parse(t);
}
__name(b64urlToJson, "b64urlToJson");
function genId(e) {
  return `${e}_${crypto.randomUUID().replace(/-/g, "")}`;
}
__name(genId, "genId");
var jwksCache = { keys: null, fetchedAt: 0 };
async function getJwks(e) {
  if (jwksCache.keys && Date.now() - jwksCache.fetchedAt < 36e5) return jwksCache.keys;
  const r = `https://${e.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`, t = await fetch(r);
  if (!t.ok) throw new Error(`Failed to fetch Access JWKS: ${t.status}`);
  const s = await t.json();
  return jwksCache.keys = s.keys || [], jwksCache.fetchedAt = Date.now(), jwksCache.keys;
}
__name(getJwks, "getJwks");
async function importJwk(e) {
  return crypto.subtle.importKey("jwk", e, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}
__name(importJwk, "importJwk");
async function verifyAccessJwt(e, r) {
  const t = e.headers.get("Cf-Access-Jwt-Assertion");
  if (!t) return { ok: false, status: 401, error: "Missing Cf-Access-Jwt-Assertion header" };
  const s = t.split(".");
  if (3 !== s.length) return { ok: false, status: 401, error: "Malformed Access JWT" };
  const [o, n, a] = s;
  let i, d;
  try {
    i = b64urlToJson(o), d = b64urlToJson(n);
  } catch (e2) {
    return { ok: false, status: 401, error: "Unable to parse Access JWT" };
  }
  const c = Math.floor(Date.now() / 1e3);
  if ("number" == typeof d.exp && c >= d.exp) return { ok: false, status: 401, error: "Access JWT expired" };
  if ("number" == typeof d.nbf && c < d.nbf) return { ok: false, status: 401, error: "Access JWT not yet valid" };
  const u = Array.isArray(d.aud) ? d.aud : [d.aud], l = (r.ACCESS_AUD || "").split(",").map((e2) => e2.trim()).filter(Boolean);
  if (!u.some((e2) => l.includes(e2))) return { ok: false, status: 401, error: "Access JWT audience mismatch" };
  let p;
  try {
    p = await getJwks(r);
  } catch (e2) {
    return { ok: false, status: 503, error: "Unable to fetch Access JWKS" };
  }
  const w = p.find((e2) => e2.kid === i.kid);
  if (!w) return { ok: false, status: 401, error: "Unknown Access signing key" };
  let _;
  try {
    _ = await importJwk(w);
  } catch (e2) {
    return { ok: false, status: 500, error: "Failed to import Access signing key" };
  }
  const h = new TextEncoder().encode(`${o}.${n}`), f = b64urlToUint8Array(a);
  let m = false;
  try {
    m = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", _, f, h);
  } catch (e2) {
    m = false;
  }
  if (!m) return { ok: false, status: 401, error: "Access JWT signature invalid" };
  const y = (d.email || "").toLowerCase().trim();
  return y ? { ok: true, email: y, payload: d } : { ok: false, status: 401, error: "Access JWT missing email claim" };
}
__name(verifyAccessJwt, "verifyAccessJwt");
async function resolveUser(e, r) {
  const t = await e.DB.prepare("SELECT u.id, u.org_id, u.email, u.name, u.role_id, u.status,\n            r.code AS role_code, r.name AS role_name\n     FROM users u\n     JOIN roles r ON r.id = u.role_id\n     WHERE u.email = ? AND u.deleted_at IS NULL").bind(r).first();
  if (!t) return null;
  if ("active" !== t.status) return null;
  const s = await e.DB.prepare("SELECT p.code FROM role_permissions rp\n     JOIN permissions p ON p.id = rp.permission_id\n     WHERE rp.role_id = ?").bind(t.role_id).all(), o = new Set((s.results || []).map((e2) => e2.code));
  return { id: t.id, orgId: t.org_id, email: t.email, name: t.name, roleId: t.role_id, roleCode: t.role_code, roleName: t.role_name, permissions: o, isOwner: "owner_admin" === t.role_code };
}
__name(resolveUser, "resolveUser");
function hasPerm(e, r) {
  return e.isOwner || e.permissions.has(r);
}
__name(hasPerm, "hasPerm");
var RESOURCES = { contacts: { table: "contacts", writable: ["name", "brokerage", "state", "timezone", "status", "email", "phone", "services", "lead_source", "transactions_per_year", "monthly_override", "rate_locked_until", "notice_days", "week_one_target", "drive_folder_url", "consent_given_at", "consent_source", "consent_withdrawn_at", "work_start", "work_end", "owner_user_id", "notes", "onboarding_nda", "onboarding_vault", "onboarding_access_log", "compliance_verified_at"], viewPerm: "perm_clients_view", writePerm: null }, deals: { table: "deals", writable: ["contact_id", "stage", "meeting_at", "prep_due_at", "artifact_type", "artifact_minutes", "scope_agreed", "no_show_count", "next_action_at", "lost_reason", "checks", "stage_at"], viewPerm: "perm_sales_view", writePerm: "perm_sales_edit" }, tickets: { table: "tickets", writable: ["contact_id", "title", "type", "status", "module", "channel", "owner_user_id", "assignee_user_id", "status_at", "minutes", "body", "closed_at"], viewPerm: "perm_tickets_view", writePerm: null }, work_items: { table: "work_items", writable: ["contact_id", "ticket_id", "title", "module", "source", "status", "assignee_user_id", "due_at", "minutes", "runs_outside_plan", "completion_note", "op_status", "sop_instance_id", "sop_step_id", "sop_phase", "evidence_required", "social_post_id"], viewPerm: "perm_work_view_own", writePerm: "perm_work_view_own", ownFilterColumn: "assignee_user_id" }, reminders: { table: "reminders", writable: ["contact_id", "kind", "title", "at", "done", "assignee_user_id"], viewPerm: "perm_work_view_own", writePerm: "perm_work_view_own", ownFilterColumn: "assignee_user_id" }, meetings: { table: "meetings", writable: ["contact_id", "kind", "at", "source", "notes"], viewPerm: "perm_clients_view", writePerm: null }, calls: { table: "calls", writable: ["contact_id", "at", "outcome", "note", "by_user_id", "queue"], viewPerm: "perm_calls_view", writePerm: null, noUpdatedAt: true, noDeletedAt: true }, notes: { table: "notes", writable: ["entity_type", "entity_id", "body", "url", "by_user_id", "edited_at"], viewPerm: "perm_clients_view", writePerm: null, noCreatedAt: true, createdAtCol: "at", noUpdatedAt: true }, social_posts: { table: "social_posts", writable: ["contact_id", "account_id", "platform", "format", "preset", "objective", "title", "caption", "audience_tz", "scheduled_at", "assignee_user_id", "approval_required", "status", "published_at"], viewPerm: "perm_social_view", writePerm: null }, activity_log: { table: "activity_log", writable: [], viewPerm: "perm_activity_view", writePerm: null, readOnly: true, noCreatedAt: true, createdAtCol: "at", noUpdatedAt: true, noDeletedAt: true } };
function isoNow() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
__name(isoNow, "isoNow");
async function logActivity(e, r, t, s, o, n) {
  try {
    const a = `${t}:${s}${o ? `:${o}` : ""}`;
    await e.DB.prepare("INSERT INTO activity_log (id, org_id, who_user_id, what, contact_id) VALUES (?, ?, ?, ?, ?)").bind(genId("act"), r.orgId, r.id, a, n || null).run();
  } catch (e2) {
    console.error("activity_log insert failed", e2.message);
  }
}
__name(logActivity, "logActivity");
async function handleResourceRequest(e, r, t, s, o) {
  const n = RESOURCES[s];
  if (!n) return errorResponse("Unknown resource", 404);
  const a = e.method, i = !n.noDeletedAt, d = !n.noUpdatedAt, c = n.createdAtCol || "created_at";
  if ("GET" === a) {
    if (!hasPerm(t, n.viewPerm)) return errorResponse("Forbidden", 403);
    let e2 = `SELECT * FROM ${n.table}`;
    const a2 = [], d2 = [], u = "work_items" === s ? "wi.org_id" : "org_id";
    if (a2.push(`${u} = ?`), d2.push(t.orgId), i && a2.push(("work_items" === s ? "wi." : "") + "deleted_at IS NULL"), !t.isOwner && n.ownFilterColumn && ("work_items" === s ? (e2 = "SELECT wi.* FROM work_items wi JOIN work_assignments wa ON wa.work_item_id = wi.id", a2.push("wa.user_id = ?"), d2.push(t.id)) : (a2.push(`${n.ownFilterColumn} = ?`), d2.push(t.id))), o) {
      a2.push("work_items" === s ? "wi.id = ?" : "id = ?"), d2.push(o);
      const t2 = a2.length ? `${e2} WHERE ${a2.join(" AND ")}` : e2, n2 = await r.DB.prepare(t2).bind(...d2).first();
      return n2 ? json({ data: n2 }) : errorResponse("Not found", 404);
    }
    let l = a2.length ? `${e2} WHERE ${a2.join(" AND ")}` : e2;
    l += ` ORDER BY ${"work_items" === s ? "wi." + c : c} DESC LIMIT 200`;
    return json({ data: (await r.DB.prepare(l).bind(...d2).all()).results || [] });
  }
  if (n.readOnly) return errorResponse("Read-only resource", 405);
  if ("POST" === a) {
    if (!hasPerm(t, n.writePerm)) return errorResponse("Forbidden", 403);
    let o2;
    try {
      o2 = await e.json();
    } catch (e2) {
      return errorResponse("Invalid JSON body", 400);
    }
    const a2 = genId(s.slice(0, 4)), i2 = ["id", "org_id"], d2 = [a2, t.orgId];
    for (const e2 of n.writable) Object.prototype.hasOwnProperty.call(o2, e2) && (i2.push(e2), d2.push(o2[e2]));
    const c2 = i2.map(() => "?").join(", ");
    try {
      await r.DB.prepare(`INSERT INTO ${n.table} (${i2.join(", ")}) VALUES (${c2})`).bind(...d2).run();
    } catch (e2) {
      return errorResponse(`Insert failed: ${e2.message}`, 400);
    }
    await logActivity(r, t, "create", s, a2, o2.contact_id);
    return json({ data: await r.DB.prepare(`SELECT * FROM ${n.table} WHERE id = ?`).bind(a2).first() }, 201);
  }
  if ("PATCH" === a || "PUT" === a) {
    if (!hasPerm(t, n.writePerm)) return errorResponse("Forbidden", 403);
    if (!o) return errorResponse("Missing id", 400);
    if (!t.isOwner && n.ownFilterColumn) if ("work_items" === s) {
      if (!await r.DB.prepare("SELECT 1 FROM work_assignments WHERE work_item_id = ? AND user_id = ?").bind(o, t.id).first()) return errorResponse("Forbidden", 403);
    } else {
      const e2 = await r.DB.prepare(`SELECT ${n.ownFilterColumn} AS owner FROM ${n.table} WHERE id = ?`).bind(o).first();
      if (!e2 || e2.owner !== t.id) return errorResponse("Forbidden", 403);
    }
    let a2;
    try {
      a2 = await e.json();
    } catch (e2) {
      return errorResponse("Invalid JSON body", 400);
    }
    const i2 = [], c2 = [];
    for (const e2 of n.writable) Object.prototype.hasOwnProperty.call(a2, e2) && (i2.push(`${e2} = ?`), c2.push(a2[e2]));
    if (0 === i2.length) return errorResponse("No writable fields provided", 400);
    d && (i2.push("updated_at = ?"), c2.push(isoNow())), c2.push(o);
    try {
      await r.DB.prepare(`UPDATE ${n.table} SET ${i2.join(", ")} WHERE id = ?`).bind(...c2).run();
    } catch (e2) {
      return errorResponse(`Update failed: ${e2.message}`, 400);
    }
    await logActivity(r, t, "update", s, o, a2.contact_id);
    const u = await r.DB.prepare(`SELECT * FROM ${n.table} WHERE id = ?`).bind(o).first();
    return u ? json({ data: u }) : errorResponse("Not found", 404);
  }
  if ("DELETE" === a) {
    if (!t.isOwner) return errorResponse("Forbidden: only Owner/Admin can delete", 403);
    if (!o) return errorResponse("Missing id", 400);
    if (!i) return errorResponse("This resource does not support deletion via the API", 405);
    try {
      await r.DB.prepare(`UPDATE ${n.table} SET deleted_at = ? WHERE id = ?`).bind(isoNow(), o).run();
    } catch (e2) {
      return errorResponse(`Delete failed: ${e2.message}`, 400);
    }
    return await logActivity(r, t, "delete", s, o, null), json({ data: { id: o, deleted: true } });
  }
  return errorResponse("Method not allowed", 405);
}
__name(handleResourceRequest, "handleResourceRequest");
function bytesToB64(e) {
  let r = "";
  for (let t = 0; t < e.length; t++) r += String.fromCharCode(e[t]);
  return btoa(r);
}
__name(bytesToB64, "bytesToB64");
function b64ToBytes(e) {
  const r = atob(e), t = new Uint8Array(r.length);
  for (let e2 = 0; e2 < r.length; e2++) t[e2] = r.charCodeAt(e2);
  return t;
}
__name(b64ToBytes, "b64ToBytes");
async function pbkdf2Hash(e, r, t) {
  const s = new TextEncoder(), o = await crypto.subtle.importKey("raw", s.encode(e), { name: "PBKDF2" }, false, ["deriveBits"]), n = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: r, iterations: t, hash: "SHA-256" }, o, 256);
  return new Uint8Array(n);
}
__name(pbkdf2Hash, "pbkdf2Hash");
async function hashPassword(e) {
  const r = crypto.getRandomValues(new Uint8Array(16)), t = await pbkdf2Hash(e, r, 1e5);
  return `100000:${bytesToB64(r)}:${bytesToB64(t)}`;
}
__name(hashPassword, "hashPassword");
function timingSafeEqual(e, r) {
  if (e.length !== r.length) return false;
  let t = 0;
  for (let s = 0; s < e.length; s++) t |= e[s] ^ r[s];
  return 0 === t;
}
__name(timingSafeEqual, "timingSafeEqual");
async function verifyPassword(e, r) {
  if (!r) return false;
  const t = r.split(":");
  if (3 !== t.length) return false;
  const [s, o, n] = t, a = parseInt(s, 10);
  if (!Number.isFinite(a) || a <= 0) return false;
  const i = b64ToBytes(o), d = b64ToBytes(n);
  return timingSafeEqual(await pbkdf2Hash(e, i, a), d);
}
__name(verifyPassword, "verifyPassword");
async function handleAuthRequest(e, r, t, s) {
  if ("POST" !== e.method) return errorResponse("Method not allowed", 405);
  let o;
  try {
    o = await e.json();
  } catch (e2) {
    return errorResponse("Invalid JSON body", 400);
  }
  if ("set-password" === s) {
    const { password: e2, currentPassword: s2 } = o;
    if ("string" != typeof e2 || e2.length < 10) return errorResponse("Password must be at least 10 characters", 400);
    const n = await r.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(t.id).first();
    if (n && n.password_hash && ("string" != typeof s2 || !await verifyPassword(s2, n.password_hash))) return errorResponse("Current password is incorrect", 403);
    const a = await hashPassword(e2);
    return await r.DB.prepare("UPDATE users SET password_hash = ?, password_algo = ?, password_set_at = ? WHERE id = ?").bind(a, "pbkdf2-sha256", isoNow(), t.id).run(), await logActivity(r, t, "set-password", "users", t.id, null), json({ data: { ok: true } });
  }
  if ("verify-password" === s) {
    const { password: e2 } = o;
    if ("string" != typeof e2) return errorResponse("Missing password", 400);
    const s2 = await r.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(t.id).first();
    if (!s2 || !s2.password_hash) return json({ data: { valid: false, reason: "no_password_set" } });
    return json({ data: { valid: await verifyPassword(e2, s2.password_hash) } });
  }
  if ("admin-set-password" === s) {
    if (!t.isOwner) return errorResponse("Forbidden: only Owner/Admin can reset other users' passwords", 403);
    const { userId: e2, password: s2 } = o;
    if ("string" != typeof e2 || "string" != typeof s2 || s2.length < 10) return errorResponse("userId and a password of at least 10 characters are required", 400);
    if (!await r.DB.prepare("SELECT id FROM users WHERE id = ? AND deleted_at IS NULL").bind(e2).first()) return errorResponse("User not found", 404);
    const n = await hashPassword(s2);
    return await r.DB.prepare("UPDATE users SET password_hash = ?, password_algo = ?, password_set_at = ? WHERE id = ?").bind(n, "pbkdf2-sha256", isoNow(), e2).run(), await logActivity(r, t, "admin-set-password", "users", e2, null), json({ data: { ok: true } });
  }
  return errorResponse("Unknown auth action", 404);
}
__name(handleAuthRequest, "handleAuthRequest");
function meResponse(e, r) {
  return json({ id: e.id, email: e.email, name: e.name, role: e.roleCode, roleName: e.roleName, isOwner: e.isOwner, permissions: Array.from(e.permissions), hasPasswordSet: !!r });
}
__name(meResponse, "meResponse");
async function handleDbBlobRequest(e, r, t) {
  if ("GET" === e.method) {
    const e2 = await r.DB.prepare("SELECT data, updated_at, updated_by FROM crm_snapshot WHERE org_id = ?").bind(t.orgId).first();
    if (!e2) return json({ data: null });
    let s;
    try {
      s = JSON.parse(e2.data);
    } catch (e3) {
      return errorResponse("Stored snapshot is corrupted; contact the Owner/Admin", 500);
    }
    return json({ data: s, updatedAt: e2.updated_at, updatedBy: e2.updated_by });
  }
  if ("PUT" === e.method) {
    let s;
    try {
      s = await e.json();
    } catch (e2) {
      return errorResponse("Invalid JSON body", 400);
    }
    if (null === s || "object" != typeof s || Array.isArray(s)) return errorResponse("Body must be a JSON object (the whole db)", 400);
    const o = JSON.stringify(s);
    if (o.length > 8388608) return errorResponse("Snapshot too large", 413);
    const n = isoNow();
    return await r.DB.prepare("INSERT INTO crm_snapshot (org_id, data, updated_at, updated_by)\n       VALUES (?, ?, ?, ?)\n       ON CONFLICT(org_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(t.orgId, o, n, t.id).run(), await logActivity(r, t, "save-snapshot", "crm_snapshot", t.orgId, null), json({ data: { ok: true, updatedAt: n } });
  }
  return errorResponse("Method not allowed", 405);
}
__name(handleDbBlobRequest, "handleDbBlobRequest");
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set(["https://crm.sereneop.com"]);
function corsHeaders(e) {
  const r = e.headers.get("Origin");
  return r && ALLOWED_ORIGINS.has(r) ? { "Access-Control-Allow-Origin": r, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type, Cf-Access-Jwt-Assertion", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS", Vary: "Origin" } : {};
}
__name(corsHeaders, "corsHeaders");
function withCors(e, r) {
  const t = corsHeaders(r);
  for (const [r2, s] of Object.entries(t)) e.headers.set(r2, s);
  return e;
}
__name(withCors, "withCors");
var BACKUP_TABLES = ["access_records", "activity_log", "audit_log", "automation_rules", "automation_runs", "business_tasks", "calls", "client_commercial", "client_scope", "client_services", "clients", "compliance_jurisdictions", "compliance_overlays", "compliance_reviews", "compliance_rules", "compliance_sources", "contacts", "crm_snapshot", "deal_stage_history", "deals", "files", "meetings", "notes", "organizations", "permissions", "reminders", "reports", "role_permissions", "roles", "scope_usage", "sessions", "social_accounts", "social_performance", "social_posts", "social_schedule", "sop_approvals", "sop_evidence", "sop_instance_steps", "sop_instances", "sop_sources", "sop_steps", "sop_template_sources", "sop_template_versions", "sop_templates", "ticket_history", "tickets", "users", "work_assignments", "work_history", "work_items", "work_time_logs"];
var BACKUP_RETENTION_DAYS = 45;
async function runNightlyBackup(env) {
  const dump = {};
  const errors = {};
  for (const table of BACKUP_TABLES) {
    try {
      const result = await env.DB.prepare("SELECT * FROM " + table).all();
      let rows = result.results || [];
      if (table === "users") {
        rows = rows.map(function(r) {
          const copy = Object.assign({}, r);
          delete copy.password_hash;
          return copy;
        });
      }
      dump[table] = rows;
    } catch (e) {
      errors[table] = e.message;
    }
  }
  const timestamp = (/* @__PURE__ */ new Date()).toISOString();
  const payload = { backedUpAt: timestamp, tableCount: Object.keys(dump).length, rowCounts: Object.fromEntries(Object.entries(dump).map(function(pair) {
    return [pair[0], pair[1].length];
  })), errors: Object.keys(errors).length ? errors : void 0, tables: dump };
  const key = "backups/" + timestamp.replace(/[:.]/g, "-") + ".json";
  const body = JSON.stringify(payload);
  await env.FILES.put(key, body, { httpMetadata: { contentType: "application/json" } });
  await pruneOldBackups(env, timestamp);
  return { key, bytes: body.length, tableCount: payload.tableCount, errors };
}
__name(runNightlyBackup, "runNightlyBackup");
async function pruneOldBackups(env, nowIso) {
  try {
    const cutoff = new Date(Date.parse(nowIso) - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1e3);
    const cutoffKeyFragment = cutoff.toISOString().replace(/[:.]/g, "-");
    const listed = await env.FILES.list({ prefix: "backups/" });
    for (const obj of listed.objects || []) {
      const stamp = obj.key.slice("backups/".length);
      if (stamp < cutoffKeyFragment) {
        await env.FILES.delete(obj.key);
      }
    }
  } catch (e) {
    console.error("backup prune failed", e.message);
  }
}
__name(pruneOldBackups, "pruneOldBackups");
function nextMonthlyRenewal(rateLockedUntil, today) {
  const anchor = /* @__PURE__ */ new Date(rateLockedUntil + "T00:00:00Z");
  if (isNaN(anchor.getTime())) return null;
  const next = new Date(anchor.getTime());
  while (next.getTime() < today.getTime()) {
    next.setUTCMonth(next.getUTCMonth() + 1);
  }
  return next;
}
__name(nextMonthlyRenewal, "nextMonthlyRenewal");
async function runContractDeadlineCheck(env) {
  const rows = (await env.DB.prepare("SELECT org_id, data FROM crm_snapshot").all()).results || [];
  const today = /* @__PURE__ */ new Date();
  const summary = [];
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch (e) {
      continue;
    }
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    if (!Array.isArray(data.reminders)) data.reminders = [];
    let changed = false;
    for (const c of contacts) {
      if (c.status !== "Client") continue;
      if (!c.rate_locked_until) continue;
      const noticeDays = Number(c.notice_days);
      const effectiveNotice = Number.isFinite(noticeDays) && noticeDays > 0 ? noticeDays : 15;
      const renewal = nextMonthlyRenewal(c.rate_locked_until, today);
      if (!renewal) continue;
      const noticeStart = new Date(renewal.getTime() - effectiveNotice * 24 * 60 * 60 * 1e3);
      if (today.getTime() < noticeStart.getTime() || today.getTime() > renewal.getTime()) continue;
      const cycleKey = renewal.toISOString().slice(0, 10);
      const marker = "contract-notice:" + c.id + ":" + cycleKey;
      const already = data.reminders.some(function(rm) {
        return rm.system_marker === marker;
      });
      if (already) continue;
      data.reminders.push({
        id: genId("rem"),
        contact_id: c.id,
        kind: "Contract notice",
        title: "Contract notice window open: " + (c.name || c.id) + "'s monthly renewal is " + cycleKey + " (" + effectiveNotice + "-day notice).",
        at: today.toISOString(),
        done: false,
        assignee: null,
        system_marker: marker
      });
      changed = true;
    }
    if (changed) {
      const body = JSON.stringify(data);
      await env.DB.prepare("UPDATE crm_snapshot SET data = ?, updated_at = ?, updated_by = ? WHERE org_id = ?").bind(body, today.toISOString(), "system:contract-deadline-engine", row.org_id).run();
      summary.push({ org_id: row.org_id, remindersAdded: true });
    }
  }
  return summary;
}
__name(runContractDeadlineCheck, "runContractDeadlineCheck");
var SVC_NAMES = { "01": "Transaction coordination", "02": "Listing management", "03": "CRM and database", "04": "Lead handling", "05": "Inbox and calendar", "06": "Marketing and social", "07": "Websites and landing pages" };
function svcName(code) {
  return SVC_NAMES[code] || code;
}
__name(svcName, "svcName");
function scopeStateOf(r) {
  const p = r.included ? (r.used || 0) / r.included : 0;
  return p > 1 ? "Over" : p >= 0.85 ? "Near limit" : "Within plan";
}
__name(scopeStateOf, "scopeStateOf");
function mondayOf(d) {
  const day = (d.getUTCDay() + 6) % 7;
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return mon;
}
__name(mondayOf, "mondayOf");
function weeklyCallPackText(c, data, monday) {
  const todos = Array.isArray(data.todos) ? data.todos : [];
  const tickets = Array.isArray(data.tickets) ? data.tickets : [];
  const scopeUsage = Array.isArray(data.scope_usage) ? data.scope_usage : [];
  const mine = todos.filter(function(t) {
    return t.contact_id === c.id;
  });
  const week = mine.filter(function(t) {
    return t.due_at && new Date(t.due_at).getTime() >= monday.getTime();
  });
  const L = [];
  L.push("SERENE OPS \xB7 WEEKLY CALL PACK \xB7 INTERNAL \xB7 DRAFT, NOT SENT");
  L.push(c.name + (c.brokerage ? " \u2014 " + c.brokerage : ""));
  L.push("Week of " + monday.toISOString().slice(0, 10));
  L.push("Generated automatically for review \u2014 nothing has been sent to the client.");
  L.push("");
  const doneW = week.filter(function(t) {
    return t.status === "Done";
  });
  const openW = week.filter(function(t) {
    return t.status === "Open";
  });
  L.push("COMPLETED THIS WEEK (" + doneW.length + ")");
  if (!doneW.length) L.push("  Nothing logged yet.");
  doneW.forEach(function(t) {
    L.push("  \xB7 " + t.title);
    L.push("      " + svcName(t.module) + " \xB7 " + (t.minutes || 0) + " min");
    if (t.completion_note) L.push("      Note: " + t.completion_note);
  });
  L.push("");
  L.push("STILL OPEN (" + openW.length + ")");
  if (!openW.length) L.push("  Nothing outstanding.");
  openW.forEach(function(t) {
    L.push("  \xB7 " + t.title + "  (" + svcName(t.module) + ")");
  });
  L.push("");
  const mins = doneW.reduce(function(a, t) {
    return a + (t.minutes || 0);
  }, 0);
  L.push("INTERNAL DELIVERY TIME: " + Math.round(mins / 6) / 10 + " hours across " + doneW.length + " completed items");
  const scopes = scopeUsage.filter(function(r) {
    return r.contact_id === c.id;
  });
  if (scopes.length) {
    L.push("");
    L.push("SCOPE / USAGE");
    scopes.forEach(function(r) {
      L.push("  \xB7 " + svcName(r.service) + ": " + r.used + " / " + r.included + " " + r.unit + " \xB7 " + scopeStateOf(r));
    });
  }
  const waits = tickets.filter(function(t) {
    return t.contact_id === c.id && t.status === "Waiting on client feedback";
  });
  if (waits.length) {
    L.push("");
    L.push("WAITING ON CLIENT");
    waits.forEach(function(t) {
      L.push("  \xB7 " + t.title);
    });
  }
  const tix = tickets.filter(function(t) {
    return t.contact_id === c.id && t.status !== "Query done";
  });
  if (tix.length) {
    L.push("");
    L.push("OPEN WITH US (" + tix.length + ")");
    tix.forEach(function(t) {
      L.push("  \xB7 [" + t.type + "] " + t.title + " \u2014 " + t.status);
    });
  }
  return L.join("\n");
}
__name(weeklyCallPackText, "weeklyCallPackText");
async function runWeeklyCallPackDrafts(env) {
  const today = /* @__PURE__ */ new Date();
  if (today.getUTCDay() !== 1) return { skipped: "not Monday (UTC)" };
  const monday = mondayOf(today);
  const weekKey = monday.toISOString().slice(0, 10);
  const rows = (await env.DB.prepare("SELECT org_id, data FROM crm_snapshot").all()).results || [];
  const summary = [];
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch (e) {
      continue;
    }
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    if (!Array.isArray(data.notes)) data.notes = [];
    if (!Array.isArray(data.reminders)) data.reminders = [];
    let changed = false;
    for (const c of contacts) {
      if (c.status !== "Client") continue;
      const marker = "weekly-call-pack:" + c.id + ":" + weekKey;
      if (data.notes.some(function(n) {
        return n.system_marker === marker;
      })) continue;
      const text = weeklyCallPackText(c, data, monday);
      data.notes.push({
        id: genId("note"),
        entity_type: "contact",
        entity_id: c.id,
        body: text,
        url: "",
        at: today.toISOString(),
        by: "Serene Ops \xB7 Weekly call pack engine (draft, unreviewed)",
        system_marker: marker
      });
      data.reminders.push({
        id: genId("rem"),
        contact_id: c.id,
        kind: "Weekly call pack",
        title: "Weekly call pack drafted for " + (c.name || c.id) + " \u2014 review before sending anything to the client.",
        at: today.toISOString(),
        done: false,
        assignee: null,
        system_marker: marker
      });
      changed = true;
    }
    if (changed) {
      const body = JSON.stringify(data);
      await env.DB.prepare("UPDATE crm_snapshot SET data = ?, updated_at = ?, updated_by = ? WHERE org_id = ?").bind(body, today.toISOString(), "system:weekly-call-pack-engine", row.org_id).run();
      summary.push({ org_id: row.org_id, draftsAdded: true });
    }
  }
  return summary;
}
__name(runWeeklyCallPackDrafts, "runWeeklyCallPackDrafts");
function minusWorkingDay(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString();
}
__name(minusWorkingDay, "minusWorkingDay");
async function runAutomationsEngine(env) {
  const rows = (await env.DB.prepare("SELECT org_id, data FROM crm_snapshot").all()).results || [];
  const now = /* @__PURE__ */ new Date();
  const summary = [];
  const after = /* @__PURE__ */ __name(function(iso, days) {
    const d = new Date(iso);
    d.setDate(d.getDate() + (days || 0));
    return d;
  }, "after");
  for (const row of rows) {
    let data;
    try {
      data = JSON.parse(row.data);
    } catch (e) {
      continue;
    }
    const rules = (Array.isArray(data.automations) ? data.automations : []).filter(function(r) {
      return r.enabled;
    });
    if (!rules.length) continue;
    const seen = {};
    (Array.isArray(data.autolog) ? data.autolog : []).forEach(function(k) {
      seen[k] = 1;
    });
    const deals = Array.isArray(data.deals) ? data.deals : [];
    const meetings = Array.isArray(data.meetings) ? data.meetings : [];
    const tickets = Array.isArray(data.tickets) ? data.tickets : [];
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    const pending = [];
    rules.forEach(function(r) {
      if (r.on === "deal_stage") {
        deals.filter(function(d) {
          return d.stage === r.stage;
        }).forEach(function(d) {
          const since = d.stage_at || d.updated_at || d.created_at;
          if (after(since, r.delayDays) > now) return;
          const key = r.id + "|" + d.id + "|" + r.stage + "|" + since;
          if (seen[key]) return;
          pending.push({ r, key, cid: d.contact_id, ref: d });
        });
      } else if (r.on === "meeting_before") {
        meetings.forEach(function(m) {
          const at = new Date(m.at);
          if (at < now) return;
          if (new Date(at.getTime() - (r.hoursBefore || 2) * 36e5) > now) return;
          const key = r.id + "|" + m.id;
          if (seen[key]) return;
          pending.push({ r, key, cid: m.contact_id, at: m.at });
        });
      } else if (r.on === "ticket_status") {
        tickets.filter(function(t) {
          return t.status === r.status;
        }).forEach(function(t) {
          if (after(t.raised_at, r.delayDays) > now) return;
          const key = r.id + "|" + t.id + "|" + r.status;
          if (seen[key]) return;
          pending.push({ r, key, cid: t.contact_id, ref: t });
        });
      } else if (r.on === "contact_status") {
        contacts.filter(function(c) {
          return c.status === r.status && !c.deleted_at;
        }).forEach(function(c) {
          const key = r.id + "|" + c.id + "|" + r.status;
          if (seen[key]) return;
          pending.push({ r, key, cid: c.id, ref: c });
        });
      }
    });
    if (!pending.length) continue;
    if (!Array.isArray(data.todos)) data.todos = [];
    if (!Array.isArray(data.reminders)) data.reminders = [];
    if (!Array.isArray(data.autolog)) data.autolog = [];
    if (!Array.isArray(data.activity)) data.activity = [];
    pending.forEach(function(p) {
      const r = p.r;
      const c = contacts.find(function(x) {
        return x.id === p.cid;
      }) || {};
      const title = String(r.title || r.name || "").split("{client}").join(c.name || "them");
      if (r.do === "task") {
        let due;
        if (r.dueFromMeeting && p.ref && p.ref.meeting_at) due = new Date(minusWorkingDay(p.ref.meeting_at));
        else {
          due = /* @__PURE__ */ new Date();
          due.setDate(due.getDate() + (r.dueInDays || 0));
        }
        due.setHours(17, 0, 0, 0);
        data.todos.unshift({
          id: genId("w"),
          org_id: row.org_id,
          contact_id: p.cid,
          ticket_id: r.on === "ticket_status" && p.ref ? p.ref.id : null,
          title,
          module: r.module || "01",
          source: "Automation",
          status: "Open",
          due_at: due.toISOString(),
          minutes: 0,
          runs_outside_plan: !!r.outside,
          assignee: r.assignee || "",
          completion_note: "",
          auto: r.id
        });
      } else {
        let at;
        if (r.on === "meeting_before" && p.at) at = new Date(new Date(p.at).getTime() - (r.hoursBefore || 2) * 36e5);
        else {
          at = /* @__PURE__ */ new Date();
          at.setDate(at.getDate() + (r.dueInDays || 0));
          at.setHours(10, 0, 0, 0);
        }
        data.reminders.unshift({
          id: genId("r"),
          contact_id: p.cid,
          kind: r.kind || "Call",
          title,
          at: at.toISOString(),
          done: false,
          assignee: r.assignee || "",
          auto: r.id
        });
      }
      data.autolog.push(p.key);
      data.activity.unshift({
        id: genId("a"),
        at: now.toISOString(),
        who: "Automation",
        what: r.name + " \u2192 " + (r.do === "task" ? "task" : "reminder") + " created for " + (c.name || "a contact"),
        contact_id: p.cid
      });
    });
    if (data.autolog.length > 600) data.autolog = data.autolog.slice(-600);
    const body = JSON.stringify(data);
    await env.DB.prepare("UPDATE crm_snapshot SET data = ?, updated_at = ?, updated_by = ? WHERE org_id = ?").bind(body, now.toISOString(), "system:automations-engine", row.org_id).run();
    summary.push({ org_id: row.org_id, automationsRan: pending.length });
  }
  return summary;
}
__name(runAutomationsEngine, "runAutomationsEngine");
async function logSystemAlert(env, jobName, errorMessage) {
  try {
    const rows = (await env.DB.prepare("SELECT org_id, data FROM crm_snapshot").all()).results || [];
    const now = /* @__PURE__ */ new Date();
    for (const row of rows) {
      let data;
      try {
        data = JSON.parse(row.data);
      } catch (e) {
        continue;
      }
      if (!Array.isArray(data.reminders)) data.reminders = [];
      data.reminders.unshift({
        id: genId("rem"),
        contact_id: null,
        kind: "System Alert",
        title: "\u26A0 " + jobName + " failed: " + String(errorMessage || "unknown error").slice(0, 300),
        at: now.toISOString(),
        done: false,
        assignee: null
      });
      const body = JSON.stringify(data);
      await env.DB.prepare("UPDATE crm_snapshot SET data = ?, updated_at = ?, updated_by = ? WHERE org_id = ?").bind(body, now.toISOString(), "system:alerting", row.org_id).run();
    }
  } catch (e) {
    console.error("logSystemAlert itself failed", e.message);
  }
}
__name(logSystemAlert, "logSystemAlert");
var worker_default = { async fetch(e, r, t) {
  const s = new URL(e.url).pathname;
  if ("OPTIONS" === e.method) return new Response(null, { status: 204, headers: corsHeaders(e) });
  if ("/api/health" === s) return withCors(json({ status: "ok", time: isoNow() }), e);
  if (!s.startsWith("/api/")) return errorResponse("Not found", 404);
  const o = await verifyAccessJwt(e, r);
  if (!o.ok) return withCors(errorResponse(o.error, o.status), e);
  const n = await resolveUser(r, o.email);
  if (!n) return withCors(errorResponse("No active CRM account found for this Access identity. Contact the Owner/Admin.", 403), e);
  const a = s.replace(/^\/api\//, "").split("/").filter(Boolean), i = a[0], d = a[1];
  if ("auth" === i) {
    return withCors(await handleAuthRequest(e, r, n, d), e);
  }
  if ("/api/db" === s) {
    return withCors(await handleDbBlobRequest(e, r, n), e);
  }
  if ("/api/me" === s) {
    const t2 = await r.DB.prepare("SELECT password_hash FROM users WHERE id = ?").bind(n.id).first();
    return withCors(meResponse(n, t2 && t2.password_hash), e);
  }
  if (RESOURCES[i]) {
    return withCors(await handleResourceRequest(e, r, n, i, d), e);
  }
  return withCors(errorResponse("Not found", 404), e);
}, async scheduled(event, env, ctx) {
  if (event.cron === "*/15 * * * *") {
    ctx.waitUntil(runAutomationsEngine(env).catch(function(e) {
      console.error("automations engine failed", e.message);
      return logSystemAlert(env, "Automations engine", e.message);
    }));
    return;
  }
  ctx.waitUntil(runNightlyBackup(env).catch(function(e) {
    console.error("nightly backup failed", e.message);
    return logSystemAlert(env, "Nightly backup", e.message);
  }));
  ctx.waitUntil(runContractDeadlineCheck(env).catch(function(e) {
    console.error("contract deadline check failed", e.message);
    return logSystemAlert(env, "Contract deadline check", e.message);
  }));
  ctx.waitUntil(runWeeklyCallPackDrafts(env).catch(function(e) {
    console.error("weekly call pack draft failed", e.message);
    return logSystemAlert(env, "Weekly call pack drafts", e.message);
  }));
  ctx.waitUntil(runAutomationsEngine(env).catch(function(e) {
    console.error("automations engine failed", e.message);
    return logSystemAlert(env, "Automations engine", e.message);
  }));
} };
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
