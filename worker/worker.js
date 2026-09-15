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
function mergeZoomMeetings(existingMeetings, zoomRows) {
  // zoom_crm_meetings is the SOLE authoritative owner of a Zoom meeting's
  // entire record -- both the Zoom-sourced fields (topic, host, status,
  // times, AI Companion summary) and the user-editable ones (contact/deal
  // link, internal notes, archive; a manual summary override sets
  // summary_source='manual' server-side and is respected by
  // reconcileMeetingSummary). crm_snapshot PUT strips zoom-tagged meetings
  // before saving (see handleDbBlobRequest), so the blob should never
  // legitimately contain one; any that slip through anyway (e.g. from a
  // client running older cached JS) are dropped here rather than trusted,
  // so there is exactly one place these fields can ever be written.
  const list = Array.isArray(existingMeetings) ? existingMeetings : [];
  const nonZoom = list.filter(function(m) { return !(m && m.zoom_meeting_id); });
  const merged = zoomRows.map(function(row) {
    return {
      id: row.id,
      kind: null,
      attendees: [],
      zoom_meeting_id: row.zoom_meeting_id,
      zoom_uuid: row.zoom_uuid,
      zoom_topic: row.zoom_topic,
      zoom_host: row.zoom_host,
      zoom_status: row.zoom_status,
      at: row.at,
      timezone: row.timezone,
      meeting_duration_seconds: row.meeting_duration_seconds,
      meeting_ended_at: row.meeting_ended_at,
      assignee: row.assignee || "Unassigned",
      matched_contact_id: row.matched_contact_id || null,
      contact_id: row.matched_contact_id || null,
      matched_deal_id: row.matched_deal_id || null,
      match_state: row.match_state || "unmatched",
      internal_notes: row.internal_notes || null,
      archived_at: row.archived_at || null,
      summary_status: row.summary_status,
      summary_source: row.summary_source,
      summary_overview: row.summary_overview,
      summary_text: row.summary_text,
      summary_details: row.summary_details ? JSON.parse(row.summary_details) : [],
      summary_next_steps: row.summary_next_steps ? JSON.parse(row.summary_next_steps) : [],
      summary_created_at: row.summary_created_at
    };
  });
  return nonZoom.concat(merged);
}
__name(mergeZoomMeetings, "mergeZoomMeetings");

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
    try {
      const zoomRows = (await r.DB.prepare("SELECT * FROM zoom_crm_meetings WHERE org_id = ?").bind(t.orgId).all()).results || [];
      if (zoomRows.length) s.meetings = mergeZoomMeetings(s.meetings, zoomRows);
    } catch (e4) {
      console.error("zoom meeting merge-on-read failed", e4.message);
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
    // zoom_crm_meetings is the sole authoritative owner of a Zoom meeting's
    // entire record (see mergeZoomMeetings). A client's snapshot always
    // reflects whatever GET last merged in, so without this filter a
    // routine autosave would copy that merged data straight back into
    // crm_snapshot -- exactly the dual-ownership/stale-copy problem this
    // architecture exists to prevent. Any meeting the client is trying to
    // save that carries a zoom_meeting_id is dropped here unconditionally;
    // legitimate edits to a Zoom meeting go through /api/zoom/meetings/:id
    // instead, which writes zoom_crm_meetings directly.
    if (Array.isArray(s.meetings)) {
      s.meetings = s.meetings.filter(function(m) { return !(m && m.zoom_meeting_id); });
    }
    const o = JSON.stringify(s);
    if (o.length > 8388608) return errorResponse("Snapshot too large", 413);
    const n = isoNow();
    return await r.DB.prepare("INSERT INTO crm_snapshot (org_id, data, updated_at, updated_by)\n       VALUES (?, ?, ?, ?)\n       ON CONFLICT(org_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, updated_by = excluded.updated_by").bind(t.orgId, o, n, t.id).run(), await logActivity(r, t, "save-snapshot", "crm_snapshot", t.orgId, null), json({ data: { ok: true, updatedAt: n } });
  }
  return errorResponse("Method not allowed", 405);
}
__name(handleDbBlobRequest, "handleDbBlobRequest");
// TEMPORARY, for the Zoom Phone Smart Embed test only: adds the exact
// stable branch-preview hostname for zoom-zoho-integration so it can call
// this same production Worker while testing. Exact-origin only, no
// wildcard, no broad *.pages.dev allowance. Remove after the phone test
// (or once merged) -- see the commit that added this line.
var ALLOWED_ORIGINS = /* @__PURE__ */ new Set(["https://crm.sereneop.com", "https://zoom-zoho-integration.serene-ops-crm.pages.dev"]);
function corsHeaders(e) {
  const r = e.headers.get("Origin");
  return r && ALLOWED_ORIGINS.has(r) ? { "Access-Control-Allow-Origin": r, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Headers": "Content-Type, Cf-Access-Jwt-Assertion, X-Requested-With", "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS", Vary: "Origin" } : {};
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

// ===== Zoom S2S OAuth + Webhook foundation (added Phase 3) =====

var zoomTokenCache = { accessToken: null, expiresAt: 0 };

async function getZoomAccessToken(env) {
  const now = Date.now();
  if (zoomTokenCache.accessToken && now < zoomTokenCache.expiresAt - 6e4) {
    return zoomTokenCache.accessToken;
  }
  if (!env.ZOOM_ACCOUNT_ID || !env.ZOOM_CLIENT_ID || !env.ZOOM_CLIENT_SECRET) {
    throw new Error("Zoom S2S OAuth credentials are not configured");
  }
  const basic = btoa(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`);
  const body = new URLSearchParams({ grant_type: "account_credentials", account_id: env.ZOOM_ACCOUNT_ID });
  const resp = await fetch("https://zoom.us/oauth/token", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.text()).slice(0, 300); } catch (_) {}
    throw new Error(`Zoom OAuth token request failed: HTTP ${resp.status} ${detail}`);
  }
  const data = await resp.json();
  if (!data.access_token) throw new Error("Zoom OAuth response missing access_token");
  zoomTokenCache.accessToken = data.access_token;
  zoomTokenCache.expiresAt = now + (Number(data.expires_in) || 3600) * 1e3;
  return zoomTokenCache.accessToken;
}
__name(getZoomAccessToken, "getZoomAccessToken");

async function zoomApiGet(env, path) {
  const token = await getZoomAccessToken(env);
  const resp = await fetch(`https://api.zoom.us/v2${path}`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  let body = null;
  try { body = await resp.json(); } catch (_) {}
  return { ok: resp.ok, status: resp.status, body };
}
__name(zoomApiGet, "zoomApiGet");
// Zoom's meeting.started / meeting.ended / meeting.summary_completed webhook
// payloads do not always carry payload.object.uuid -- observed live against
// a real test meeting on 2026-09-10, whose webhook events came back with no
// uuid at all. The numeric meeting id alone is reused across every future
// occurrence of a recurring (or reusable Personal Meeting ID) meeting, so it
// is not safe to treat as an occurrence-unique identifier. Rather than
// fabricate a uuid, this makes one best-effort attempt to recover the real
// per-occurrence uuid from Zoom's own REST API (GET /past_meetings/{meetingId}/instances,
// keyed only on the numeric meeting id -- the strongest identifier the
// webhook reliably gives us) before falling back to the documented
// meeting_id+uuid-IS-NULL composite match in reconcileMeetingLifecycle /
// reconcileMeetingSummary. If Zoom's API call fails or returns nothing, this
// returns null and the existing fallback strategy applies unchanged.
async function enrichZoomOccurrenceUuid(env, zoomMeetingId, referenceTimeIso) {
  if (!zoomMeetingId) return null;
  try {
    const resp = await zoomApiGet(env, `/past_meetings/${zoomMeetingId}/instances`);
    if (!resp.ok || !resp.body) return null;
    const instances = resp.body.meetings || resp.body.instances || [];
    if (!instances.length) return null;
    const refMs = referenceTimeIso ? new Date(referenceTimeIso).getTime() : Date.now();
    if (!Number.isFinite(refMs)) return instances[0].uuid || null;
    let best = null, bestDiff = Infinity;
    for (const inst of instances) {
      const t = new Date(inst.start_time).getTime();
      if (!Number.isFinite(t)) continue;
      const diff = Math.abs(t - refMs);
      if (diff < bestDiff) { bestDiff = diff; best = inst; }
    }
    return (best && best.uuid) || instances[0].uuid || null;
  } catch (e) {
    console.error("enrichZoomOccurrenceUuid failed", e && e.message);
    return null;
  }
}
__name(enrichZoomOccurrenceUuid, "enrichZoomOccurrenceUuid");

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacSha256Hex, "hmacSha256Hex");

async function sha256Hex(message) {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(message));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");

function timingSafeEqualStr(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
__name(timingSafeEqualStr, "timingSafeEqualStr");

async function handleZoomWebhook(request, env) {
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  if (!env.ZOOM_WEBHOOK_SECRET_TOKEN) {
    console.error("ZOOM_WEBHOOK_SECRET_TOKEN not configured");
    return errorResponse("Webhook not configured", 503);
  }

  const rawBody = await request.text();
  const timestampHeader = request.headers.get("x-zm-request-timestamp") || "";
  const signatureHeader = request.headers.get("x-zm-signature") || "";

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (_) {
    return errorResponse("Malformed payload", 400);
  }

  // The endpoint URL validation handshake is unsigned by design (Zoom sends it
  // before any secret exchange is possible), so it is handled before signature
  // checks -- but it only ever computes a hash, never reads/writes CRM data.
  if (payload && payload.event === "endpoint.url_validation" && payload.payload && payload.payload.plainToken) {
    const encryptedToken = await hmacSha256Hex(env.ZOOM_WEBHOOK_SECRET_TOKEN, payload.payload.plainToken);
    return json({ plainToken: payload.payload.plainToken, encryptedToken }, 200);
  }

  if (!timestampHeader || !signatureHeader) {
    return errorResponse("Missing signature headers", 401);
  }

  // Reject stale/replayed requests: Zoom signs with a fresh timestamp on each
  // delivery attempt, so anything outside a tight window is not a live delivery.
  const tsNum = Number(timestampHeader);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum * 1e3) > 5 * 60 * 1e3) {
    return errorResponse("Stale or invalid timestamp", 401);
  }

  const expectedSig = "v0=" + (await hmacSha256Hex(env.ZOOM_WEBHOOK_SECRET_TOKEN, `v0:${timestampHeader}:${rawBody}`));
  if (!timingSafeEqualStr(expectedSig, signatureHeader)) {
    return errorResponse("Invalid signature", 401);
  }

  // Idempotency: dedupe on a hash of the verified raw body. Zoom redelivers
  // identical payloads on retry, so a duplicate insert here means "already seen".
  const payloadHash = await sha256Hex(rawBody);
  const eventType = typeof payload.event === "string" ? payload.event : "unknown";
  // Diagnostic-only: store just the payload.payload.object (never the full
  // raw body, which could carry account-level fields) so a future real
  // test can be inspected after the fact -- this event stream previously
  // kept nothing but a hash, so whether Zoom actually sent a uuid for a
  // given occurrence could never be checked retroactively.
  let objectJson = null;
  try {
    const obj0 = payload && payload.payload && payload.payload.object;
    if (obj0) objectJson = JSON.stringify(obj0).slice(0, 8000);
  } catch (_) {}
  try {
    const result = await env.DB.prepare(
      "INSERT OR IGNORE INTO zoom_webhook_events (id, event_type, payload_hash, object_json, processed) VALUES (?, ?, ?, ?, 0)"
    ).bind(genId("zwe"), eventType, payloadHash, objectJson).run();
    const alreadySeen = !(result.meta && result.meta.changes);
    if (alreadySeen) {
      return json({ received: true, duplicate: true }, 200);
    }
  } catch (e) {
    console.error("zoom webhook idempotency insert failed", e.message);
    return errorResponse("Internal error", 500);
  }

  // The event is durably recorded and de-duplicated above. Reconciliation
  // into zoom_calls/zoom_voicemails/zoom_meetings happens here, keyed on
  // Zoom's own ids so a retried delivery updates the same row instead of
  // creating a duplicate CRM record.
  try {
    await reconcileZoomEvent(env, eventType, payload && payload.payload && payload.payload.object);
  } catch (e) {
    console.error("zoom webhook reconciliation failed", eventType, e.message);
    // Do not fail the webhook response over reconciliation errors -- the
    // event is already durably recorded for later inspection/replay.
  }

  try {
    await env.DB.prepare("UPDATE zoom_webhook_events SET processed = 1 WHERE payload_hash = ?").bind(payloadHash).run();
  } catch (e) {
    console.error("zoom webhook mark-processed failed", e.message);
  }

  return json({ received: true }, 200);
}
__name(handleZoomWebhook, "handleZoomWebhook");

// ----- Zoom Phone user mapping (authenticated CRM user -> licensed Zoom Phone user) -----
// Generic by design: never hardcodes a specific person. A CRM user with no
// active row here has no Zoom Phone identity yet, and the Dialer must show
// that plainly rather than pretending to place a call.

async function findMappedZoomUser(env, orgId, crmUserId) {
  return env.DB.prepare(
    "SELECT crm_user_id, zoom_user_id, zoom_extension, zoom_email FROM zoom_phone_user_map WHERE org_id = ? AND crm_user_id = ? AND active = 1"
  ).bind(orgId, crmUserId).first();
}
__name(findMappedZoomUser, "findMappedZoomUser");

async function findCrmUserByZoomUserId(env, orgId, zoomUserId) {
  if (!zoomUserId) return null;
  return env.DB.prepare(
    "SELECT crm_user_id, zoom_user_id FROM zoom_phone_user_map WHERE org_id = ? AND zoom_user_id = ? AND active = 1"
  ).bind(orgId, zoomUserId).first();
}
__name(findCrmUserByZoomUserId, "findCrmUserByZoomUserId");

async function loadSnapshotData(env, orgId) {
  // Real CRM records (contacts, deals, ...) live only in the crm_snapshot
  // JSON blob -- the normalized D1 tables of the same name are unused by
  // the frontend and were found empty in production. Anything that needs
  // to look a contact/deal up (matching, PATCH validation) must read the
  // blob, not those tables. Read-only: never write back through this path.
  const row = await env.DB.prepare("SELECT data FROM crm_snapshot WHERE org_id = ?").bind(orgId).first();
  if (!row || !row.data) return null;
  try {
    return JSON.parse(row.data);
  } catch (e) {
    console.error("crm_snapshot corrupted while reading for match/validation", e.message);
    return null;
  }
}
__name(loadSnapshotData, "loadSnapshotData");

async function matchContactByPhone(env, orgId, phoneNumber) {
  if (!phoneNumber) return null;
  const digits = String(phoneNumber).replace(/[^\d]/g, "").slice(-10);
  if (!digits) return null;
  const data = await loadSnapshotData(env, orgId);
  const contacts = (data && Array.isArray(data.contacts)) ? data.contacts : [];
  const match = contacts.find(function(c) {
    if (!c || c.deleted_at || !c.phone) return false;
    return String(c.phone).replace(/\D/g, "").slice(-10) === digits;
  });
  return match ? match.id : null;
}
__name(matchContactByPhone, "matchContactByPhone");

async function reconcileZoomEvent(env, eventType, obj) {
  if (!obj) return;
  const orgId = "org1";
  if (eventType === "phone.caller_ended" || eventType === "phone.callee_ended") {
    await reconcilePhoneCallEnded(env, orgId, eventType, obj);
    return;
  }
  if (eventType === "phone.voicemail_received") {
    await reconcileVoicemailReceived(env, orgId, obj);
    return;
  }
  if (eventType === "meeting.started" || eventType === "meeting.ended") {
    await reconcileMeetingLifecycle(env, orgId, eventType, obj);
    return;
  }
  if (eventType === "meeting.summary_completed") {
    await reconcileMeetingSummary(env, orgId, obj);
    return;
  }
  // Unhandled but recognized-as-received event type: nothing to reconcile.
}
__name(reconcileZoomEvent, "reconcileZoomEvent");

async function reconcilePhoneCallEnded(env, orgId, eventType, obj) {
  const callId = obj.call_id;
  if (!callId) return;
  const caller = obj.caller || {};
  const callee = obj.callee || {};
  const direction = obj.direction || null;
  const durationSeconds = typeof obj.duration === "number" ? obj.duration : null;

  // Attribution: whichever side of the call is a Zoom user we have mapped to
  // a CRM user is the "initiated_by" / handled-by identity. If neither side
  // maps to a CRM user, the call is Unassigned / Needs Attention -- never
  // guessed. We check the caller first for outbound, callee first for
  // inbound, but fall back to whichever side actually resolves.
  const byCaller = caller.user_id ? await findCrmUserByZoomUserId(env, orgId, caller.user_id) : null;
  const byCallee = callee.user_id ? await findCrmUserByZoomUserId(env, orgId, callee.user_id) : null;
  const owner = byCaller || byCallee;
  const initiatedBy = owner ? owner.crm_user_id : null;
  const attribution = owner ? "assigned" : "unassigned";

  const externalNumber = direction === "outbound" ? (callee.phone_number || null) : (caller.phone_number || null);
  const contactId = await matchContactByPhone(env, orgId, externalNumber);

  const existing = await env.DB.prepare("SELECT id FROM zoom_calls WHERE zoom_call_id = ?").bind(callId).first();
  const now = isoNow();
  if (existing) {
    // The paired event (caller_ended / callee_ended) for the same call_id can
    // arrive twice from Zoom's two perspectives -- update in place, never
    // insert a second row for the same zoom_call_id (unique index enforces
    // this too, as a backstop).
    await env.DB.prepare(
      `UPDATE zoom_calls SET direction = COALESCE(?, direction), from_number = COALESCE(?, from_number),
        to_number = COALESCE(?, to_number), status = 'ended', duration_seconds = COALESCE(?, duration_seconds),
        initiated_by = COALESCE(initiated_by, ?), attribution = CASE WHEN initiated_by IS NULL AND ? IS NOT NULL THEN 'assigned' ELSE attribution END,
        contact_id = COALESCE(contact_id, ?), match_status = CASE WHEN contact_id IS NULL AND ? IS NOT NULL THEN 'matched' ELSE match_status END,
        updated_at = ? WHERE id = ?`
    ).bind(direction, caller.phone_number || null, callee.phone_number || null, durationSeconds, initiatedBy, initiatedBy, contactId, contactId, now, existing.id).run();
    return;
  }
  await env.DB.prepare(
    `INSERT INTO zoom_calls (id, org_id, call_id, zoom_call_id, zoom_event_id, direction, from_number, to_number, status, duration_seconds, initiated_by, attribution, contact_id, match_status, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 'ended', ?, ?, ?, ?, ?, ?, ?)`
  ).bind(genId("zc"), orgId, callId, eventType, direction, caller.phone_number || null, callee.phone_number || null, durationSeconds, initiatedBy, attribution, contactId, contactId ? "matched" : "unmatched", now, now).run();
}
__name(reconcilePhoneCallEnded, "reconcilePhoneCallEnded");

async function reconcileVoicemailReceived(env, orgId, obj) {
  const vmId = obj.id;
  if (!vmId) return;
  const existing = await env.DB.prepare("SELECT id FROM zoom_voicemails WHERE id = ?").bind("zvm_" + vmId).first();
  if (existing) return;
  const contactId = await matchContactByPhone(env, orgId, obj.caller_number);
  const zoomCall = obj.call_id ? await env.DB.prepare("SELECT id FROM zoom_calls WHERE zoom_call_id = ?").bind(obj.call_id).first() : null;
  await env.DB.prepare(
    `INSERT OR IGNORE INTO zoom_voicemails (id, org_id, zoom_call_row_id, contact_id, from_number, duration_seconds, recording_url, transcript, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'unread', ?)`
  ).bind("zvm_" + vmId, orgId, zoomCall ? zoomCall.id : null, contactId, obj.caller_number || null, typeof obj.duration === "number" ? obj.duration : null, obj.download_url || null, isoNow()).run();
}
__name(reconcileVoicemailReceived, "reconcileVoicemailReceived");

async function mutateOrgSnapshot(env, orgId, mutatorFn, attempt) {
  // Server-side read-modify-write of the org's single crm_snapshot JSON blob
  // -- the same store the frontend's GET/PUT /api/db reads and writes. A
  // user's own browser can PUT its own (possibly stale, since it holds
  // whatever it loaded at page-open time) full copy of the blob at any
  // moment, which would silently clobber a plain last-write-wins save. To
  // avoid losing a server-side write to that race, this uses compare-and-
  // swap on crm_snapshot.updated_at: the write only lands if nobody else
  // changed the row since we read it; otherwise it re-reads the latest data,
  // re-applies the (idempotent, find-or-create) mutation, and retries.
  //
  // This does NOT protect against the opposite ordering -- a browser tab
  // that loaded the CRM before this write runs, then saves afterward, will
  // still overwrite this write with its own stale copy, because it never
  // knew this record was added. That is a pre-existing trait of the
  // single-blob/full-copy persistence design (not introduced here) and is
  // out of scope for this change; real-time server-pushed records remain
  // most reliable when verified against a session that reloads first.
  attempt = attempt || 0;
  const row = await env.DB.prepare("SELECT data, updated_at FROM crm_snapshot WHERE org_id = ?").bind(orgId).first();
  let data = {};
  let priorUpdatedAt = null;
  if (row && row.data) {
    try {
      data = JSON.parse(row.data);
    } catch (e) {
      console.error("crm_snapshot corrupted, skipping server-side meeting sync", e.message);
      return;
    }
    priorUpdatedAt = row.updated_at;
  }
  if (!Array.isArray(data.meetings)) data.meetings = [];
  const changed = mutatorFn(data);
  if (!changed) return;
  const now = isoNow();
  const payload = JSON.stringify(data);
  let result;
  if (priorUpdatedAt === null) {
    result = await env.DB.prepare(
      "INSERT INTO crm_snapshot (org_id, data, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(org_id) DO NOTHING"
    ).bind(orgId, payload, now, "system:zoom").run();
  } else {
    result = await env.DB.prepare(
      "UPDATE crm_snapshot SET data = ?, updated_at = ?, updated_by = ? WHERE org_id = ? AND updated_at = ?"
    ).bind(payload, now, "system:zoom", orgId, priorUpdatedAt).run();
  }
  const landed = !!(result && result.meta && result.meta.changes);
  if (landed) return;
  if (attempt >= 6) {
    console.error("mutateOrgSnapshot: gave up after concurrent-write retries", orgId);
    return;
  }
  await new Promise(function(resolve) { setTimeout(resolve, 40 + attempt * 80); });
  return mutateOrgSnapshot(env, orgId, mutatorFn, attempt + 1);
}
__name(mutateOrgSnapshot, "mutateOrgSnapshot");

async function resolveHostDisplayName(env, orgId, hostMap, obj) {
  if (hostMap && hostMap.crm_user_id) {
    try {
      const u = await env.DB.prepare("SELECT name FROM users WHERE id = ? AND org_id = ?").bind(hostMap.crm_user_id, orgId).first();
      if (u && u.name) return u.name;
    } catch (e) {
      // fall through to the raw Zoom identifiers below
    }
  }
  return obj.host_email || obj.host_id || null;
}
__name(resolveHostDisplayName, "resolveHostDisplayName");

async function backfillMeetingSyncFromLedger(env, orgId) {
  // Repair/repopulate tool: replays what the zoom_meetings ledger already
  // durably recorded from real Zoom webhook deliveries into
  // zoom_crm_meetings (the table merged into data.meetings at GET /api/db
  // read time -- see mergeZoomMeetings). Uses only data Zoom itself already
  // delivered and we already stored -- never invents anything. Each row is
  // a plain single-row upsert, so this is safe to call repeatedly.
  const rows = (await env.DB.prepare(
    "SELECT zoom_meeting_id, host_user_id, topic, start_time, duration_minutes, summary, summary_status FROM zoom_meetings WHERE org_id = ?"
  ).bind(orgId).all()).results || [];
  const hostNames = {};
  for (const row of rows) {
    if (row.host_user_id && !(row.host_user_id in hostNames)) {
      const u = await env.DB.prepare("SELECT name FROM users WHERE id = ? AND org_id = ?").bind(row.host_user_id, orgId).first();
      hostNames[row.host_user_id] = (u && u.name) || null;
    }
  }
  let touched = 0;
  const now = isoNow();
  for (const row of rows) {
    const zoomMeetingId = row.zoom_meeting_id;
    if (!zoomMeetingId) continue;
    const hostName = hostNames[row.host_user_id] || null;
    const existing = await env.DB.prepare(
      "SELECT id FROM zoom_crm_meetings WHERE org_id = ? AND zoom_meeting_id = ? AND zoom_uuid IS NULL"
    ).bind(orgId, zoomMeetingId).first();
    if (existing) {
      await env.DB.prepare(
        `UPDATE zoom_crm_meetings SET
           zoom_topic = COALESCE(?, zoom_topic), zoom_host = COALESCE(?, zoom_host),
           at = COALESCE(?, at), meeting_duration_seconds = COALESCE(?, meeting_duration_seconds),
           summary_status = CASE WHEN ? = 'available' THEN 'available' ELSE summary_status END,
           summary_source = CASE WHEN ? = 'available' AND summary_source IS NULL THEN 'zoom_ai_companion' ELSE summary_source END,
           summary_overview = CASE WHEN summary_overview IS NULL THEN ? ELSE summary_overview END,
           updated_at = ?
         WHERE id = ?`
      ).bind(row.topic || null, hostName, row.start_time || null, typeof row.duration_minutes === "number" ? row.duration_minutes * 60 : null, row.summary_status, row.summary_status, row.summary, now, existing.id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO zoom_crm_meetings (id, org_id, zoom_meeting_id, zoom_uuid, zoom_topic, zoom_host, zoom_status, assignee, at, meeting_duration_seconds, summary_status, summary_source, summary_overview, summary_created_at, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, 'ended', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        genId("meet"), orgId, zoomMeetingId, row.topic || null, hostName, hostName || "Unassigned",
        row.start_time || now, typeof row.duration_minutes === "number" ? row.duration_minutes * 60 : null,
        row.summary_status === "available" ? "available" : "none",
        row.summary_status === "available" ? "zoom_ai_companion" : null,
        row.summary_status === "available" ? row.summary : null,
        row.summary_status === "available" ? now : null, now, now
      ).run();
    }
    touched++;
  }
  return { rowsConsidered: rows.length, touched };
}
__name(backfillMeetingSyncFromLedger, "backfillMeetingSyncFromLedger");

async function reconcileMeetingLifecycle(env, orgId, eventType, obj) {
  let zoomUuid = obj.uuid || obj.meeting_uuid || null;
  const zoomMeetingId = String(obj.id || zoomUuid || "");
  if (!zoomMeetingId) return;
  if (!zoomUuid) {
    zoomUuid = await enrichZoomOccurrenceUuid(env, zoomMeetingId, obj.start_time || null);
  }
  const hostZoomUserId = obj.host_id || null;
  const hostMap = hostZoomUserId ? await findCrmUserByZoomUserId(env, orgId, hostZoomUserId) : null;
  const hostDisplayName = await resolveHostDisplayName(env, orgId, hostMap, obj);
  const now = isoNow();

  // Internal ledger (zoom_meetings): a raw record of what Zoom told us,
  // independent of the user-editable CRM meeting record below. Kept as-is
  // for audit/reconciliation purposes.
  const existingLedger = await env.DB.prepare("SELECT id FROM zoom_meetings WHERE zoom_meeting_id = ?").bind(zoomMeetingId).first();
  if (existingLedger) {
    await env.DB.prepare(
      "UPDATE zoom_meetings SET topic = COALESCE(?, topic), start_time = COALESCE(?, start_time), duration_minutes = COALESCE(?, duration_minutes), host_user_id = COALESCE(host_user_id, ?), updated_at = ? WHERE id = ?"
    ).bind(obj.topic || null, obj.start_time || null, typeof obj.duration === "number" ? obj.duration : null, hostMap ? hostMap.crm_user_id : null, now, existingLedger.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO zoom_meetings (id, org_id, meeting_id, zoom_meeting_id, host_user_id, topic, start_time, duration_minutes, join_url, summary, summary_status, created_at, updated_at)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?, ?)`
    ).bind(genId("zm"), orgId, zoomMeetingId, hostMap ? hostMap.crm_user_id : null, obj.topic || null, obj.start_time || null, typeof obj.duration === "number" ? obj.duration : null, obj.join_url || null, now, now).run();
  }

  // CRM-visible record: zoom_crm_meetings, merged into data.meetings at
  // GET /api/db read time (see mergeZoomMeetings) rather than written into
  // the crm_snapshot blob directly. A single-row UPSERT here is naturally
  // race-free (D1 handles it atomically per row), unlike a blob rewrite,
  // which a stale browser tab's own full-blob save can silently clobber
  // either before or after this write lands -- that failure mode was
  // observed in the first live test and is why this table exists. Matched
  // on the per-occurrence Zoom uuid when available so recurring meetings
  // don't collide into one row; falls back to the reusable numeric meeting
  // id only when no uuid was ever supplied.
  const matchCol = zoomUuid ? "zoom_uuid = ?" : "zoom_meeting_id = ? AND zoom_uuid IS NULL";
  const matchVal = zoomUuid || zoomMeetingId;
  const existingCrm = await env.DB.prepare(
    `SELECT id, zoom_status FROM zoom_crm_meetings WHERE org_id = ? AND ${matchCol}`
  ).bind(orgId, matchVal).first();
  const newStatus = eventType === "meeting.ended" ? "ended" : "started";
  if (existingCrm) {
    const finalStatus = eventType === "meeting.ended" ? "ended" : (existingCrm.zoom_status === "ended" ? "ended" : "started");
    await env.DB.prepare(
      `UPDATE zoom_crm_meetings SET
         zoom_topic = COALESCE(?, zoom_topic),
         zoom_host = COALESCE(?, zoom_host),
         assignee = CASE WHEN assignee IS NULL OR assignee = 'Unassigned' THEN COALESCE(?, assignee) ELSE assignee END,
         at = COALESCE(?, at),
         timezone = COALESCE(?, timezone),
         zoom_status = ?,
         meeting_ended_at = COALESCE(?, meeting_ended_at),
         meeting_duration_seconds = COALESCE(?, meeting_duration_seconds),
         updated_at = ?
       WHERE id = ?`
    ).bind(
      obj.topic || null, hostDisplayName || null, hostDisplayName || null,
      obj.start_time || null, obj.timezone || null, finalStatus,
      eventType === "meeting.ended" ? (obj.end_time || now) : null,
      eventType === "meeting.ended" && typeof obj.duration === "number" ? obj.duration * 60 : null,
      now, existingCrm.id
    ).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO zoom_crm_meetings (id, org_id, zoom_meeting_id, zoom_uuid, zoom_topic, zoom_host, zoom_status, assignee, at, timezone, meeting_duration_seconds, meeting_ended_at, summary_status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?)`
    ).bind(
      genId("meet"), orgId, zoomMeetingId, zoomUuid, obj.topic || null, hostDisplayName || null, newStatus,
      hostDisplayName || "Unassigned", obj.start_time || now, obj.timezone || null,
      eventType === "meeting.ended" && typeof obj.duration === "number" ? obj.duration * 60 : null,
      eventType === "meeting.ended" ? (obj.end_time || now) : null,
      now, now
    ).run();
  }
}
__name(reconcileMeetingLifecycle, "reconcileMeetingLifecycle");

async function reconcileMeetingSummary(env, orgId, obj) {
  let zoomUuid = obj.meeting_uuid || obj.uuid || null;
  const zoomMeetingId = String(obj.meeting_id || obj.id || zoomUuid || "");
  if (!zoomMeetingId) return;
  if (!zoomUuid) {
    zoomUuid = await enrichZoomOccurrenceUuid(env, zoomMeetingId, obj.meeting_start_time || obj.start_time || null);
  }
  const overview = obj.summary_overview || obj.summary_title || null;
  const normalizeItems = function(arr) {
    return (Array.isArray(arr) ? arr : []).map(function(x) {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") return x.summary || x.label || x.content || JSON.stringify(x);
      return String(x);
    }).filter(Boolean);
  };
  const details = normalizeItems(obj.summary_details);
  const steps = normalizeItems(obj.next_steps);
  const fullText = obj.summary_content || (details.length ? details.join("\n\n") : null);
  if (!overview && !details.length && !fullText) return;
  const now = isoNow();

  await env.DB.prepare(
    "UPDATE zoom_meetings SET summary = ?, summary_status = 'available', updated_at = ? WHERE zoom_meeting_id = ?"
  ).bind(overview || fullText || JSON.stringify(details), now, zoomMeetingId).run();

  // Same race-free single-row upsert pattern as reconcileMeetingLifecycle,
  // against zoom_crm_meetings (merged into data.meetings at GET time).
  const matchCol = zoomUuid ? "zoom_uuid = ?" : "zoom_meeting_id = ? AND zoom_uuid IS NULL";
  const matchVal = zoomUuid || zoomMeetingId;
  const existingCrm = await env.DB.prepare(
    `SELECT id FROM zoom_crm_meetings WHERE org_id = ? AND ${matchCol}`
  ).bind(orgId, matchVal).first();
  const detailsJson = details.length ? JSON.stringify(details) : null;
  const stepsJson = steps.length ? JSON.stringify(steps) : null;
  if (existingCrm) {
    // A user's own manual override (set via PATCH, summary_source='manual')
    // takes precedence over a real Zoom AI Companion summary arriving after
    // it -- never silently replace what a person wrote with what Zoom sent.
    await env.DB.prepare(
      `UPDATE zoom_crm_meetings SET
         summary_status = CASE WHEN summary_source = 'manual' THEN summary_status ELSE 'available' END,
         summary_source = CASE WHEN summary_source = 'manual' THEN summary_source ELSE 'zoom_ai_companion' END,
         summary_overview = CASE WHEN summary_source = 'manual' THEN summary_overview ELSE COALESCE(?, summary_overview) END,
         summary_text = CASE WHEN summary_source = 'manual' THEN summary_text ELSE COALESCE(?, summary_text) END,
         summary_details = CASE WHEN summary_source = 'manual' THEN summary_details ELSE COALESCE(?, summary_details) END,
         summary_next_steps = CASE WHEN summary_source = 'manual' THEN summary_next_steps ELSE COALESCE(?, summary_next_steps) END,
         summary_created_at = CASE WHEN summary_source = 'manual' THEN summary_created_at ELSE ? END,
         updated_at = ?
       WHERE id = ?`
    ).bind(overview || null, fullText || null, detailsJson, stepsJson, now, now, existingCrm.id).run();
  } else {
    // A summary can in principle arrive without a lifecycle event we
    // captured first -- still record it rather than silently dropping a
    // real Zoom AI Companion summary. Never fabricate anything beyond what
    // this event itself tells us.
    await env.DB.prepare(
      `INSERT INTO zoom_crm_meetings (id, org_id, zoom_meeting_id, zoom_uuid, zoom_status, assignee, summary_status, summary_source, summary_overview, summary_text, summary_details, summary_next_steps, summary_created_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'ended', 'Unassigned', 'available', 'zoom_ai_companion', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(genId("meet"), orgId, zoomMeetingId, zoomUuid, overview || null, fullText || null, detailsJson, stepsJson, now, now, now).run();
  }
}
__name(reconcileMeetingSummary, "reconcileMeetingSummary");

async function handleZoomMeetingPatch(request, env, user, zoomMeetingId) {
  // The only place a Zoom meeting's user-editable fields (contact/deal
  // link, internal notes, archive, manual summary override) can be
  // written. zoom_crm_meetings is the sole owner of the whole record --
  // crm_snapshot PUT strips zoom-tagged meetings before saving, so this
  // endpoint (not the giant snapshot PUT) is how the CRM Meetings UI must
  // persist edits to a Zoom meeting from here on.
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return errorResponse("Invalid JSON body", 400);
  }
  const row = await env.DB.prepare("SELECT id FROM zoom_crm_meetings WHERE org_id = ? AND zoom_meeting_id = ?").bind(user.orgId, zoomMeetingId).first();
  if (!row) return errorResponse("Zoom meeting not found", 404);

  const sets = [];
  const vals = [];
  if (Object.prototype.hasOwnProperty.call(body, "contactId")) {
    if (body.contactId) {
      const data = await loadSnapshotData(env, user.orgId);
      const contacts = (data && Array.isArray(data.contacts)) ? data.contacts : [];
      const contact = contacts.find(function(c) { return c && c.id === body.contactId && !c.deleted_at; });
      if (!contact) return errorResponse("Contact not found", 404);
      sets.push("matched_contact_id = ?");
      vals.push(body.contactId);
      sets.push("match_state = 'matched'");
    } else {
      sets.push("matched_contact_id = NULL", "match_state = 'unmatched'");
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "dealId")) {
    if (body.dealId) {
      const data = await loadSnapshotData(env, user.orgId);
      const deals = (data && Array.isArray(data.deals)) ? data.deals : [];
      const deal = deals.find(function(d) { return d && d.id === body.dealId; });
      if (!deal) return errorResponse("Deal not found", 404);
      sets.push("matched_deal_id = ?");
      vals.push(body.dealId);
    } else {
      sets.push("matched_deal_id = NULL");
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "internalNotes")) {
    sets.push("internal_notes = ?");
    vals.push(String(body.internalNotes || ""));
  }
  if (Object.prototype.hasOwnProperty.call(body, "archived")) {
    sets.push("archived_at = ?");
    vals.push(body.archived ? isoNow() : null);
  }
  if (Object.prototype.hasOwnProperty.call(body, "manualSummary")) {
    const text = String(body.manualSummary || "").trim();
    if (!text) return errorResponse("manualSummary cannot be empty", 400);
    sets.push("summary_overview = ?", "summary_status = 'available'", "summary_source = 'manual'", "summary_created_at = ?");
    vals.push(text, isoNow());
  }
  if (!sets.length) return errorResponse("No recognized fields to update (contactId, dealId, internalNotes, archived, manualSummary)", 400);
  sets.push("updated_at = ?");
  vals.push(isoNow());
  vals.push(row.id);
  await env.DB.prepare(`UPDATE zoom_crm_meetings SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
  return json({ data: { ok: true } });
}
__name(handleZoomMeetingPatch, "handleZoomMeetingPatch");

async function handleZoomPhoneUsers(env) {
  // Owner/Admin-only, read-only. Lists real Zoom Phone users (id/email/ext)
  // so an Owner can map a CRM user to the correct Zoom Phone identity once
  // that CRM user has a Zoom Phone license. Never exposes tokens/secrets.
  try {
    const r = await zoomApiGet(env, "/phone/users?page_size=100");
    if (!r.ok) return { ok: false, status: r.status, error: (r.body && r.body.message) || "Zoom API error" };
    const users = Array.isArray(r.body && r.body.users) ? r.body.users : [];
    return {
      ok: true,
      users: users.map(function(u) {
        return { zoomUserId: u.user_id || u.id, email: u.email, name: [u.first_name, u.last_name].filter(Boolean).join(" "), extensionNumber: u.extension_number || u.ext || null, status: u.status || null };
      })
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
__name(handleZoomPhoneUsers, "handleZoomPhoneUsers");

async function handleZoomPhoneMapping(request, env, user) {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const targetUserId = (user.isOwner && url.searchParams.get("userId")) || user.id;
    const row = await findMappedZoomUser(env, user.orgId, targetUserId);
    return json({ data: row || null });
  }
  if (request.method === "POST") {
    if (!user.isOwner) return errorResponse("Forbidden: only Owner/Admin can map Zoom Phone identities", 403);
    let body;
    try { body = await request.json(); } catch (_) { return errorResponse("Invalid JSON body", 400); }
    const crmUserId = body && body.crmUserId;
    const zoomUserId = body && body.zoomUserId;
    if (!crmUserId || !zoomUserId) return errorResponse("crmUserId and zoomUserId are required", 400);
    const target = await env.DB.prepare("SELECT id FROM users WHERE id = ? AND org_id = ? AND deleted_at IS NULL").bind(crmUserId, user.orgId).first();
    if (!target) return errorResponse("CRM user not found", 404);
    const now = isoNow();
    await env.DB.prepare(
      `INSERT INTO zoom_phone_user_map (id, org_id, crm_user_id, zoom_user_id, zoom_extension, zoom_email, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(org_id, crm_user_id) DO UPDATE SET zoom_user_id = excluded.zoom_user_id, zoom_extension = excluded.zoom_extension, zoom_email = excluded.zoom_email, active = 1, updated_at = excluded.updated_at`
    ).bind(genId("zpm"), user.orgId, crmUserId, zoomUserId, body.zoomExtension || null, body.zoomEmail || null, now, now).run();
    await logActivity(env, user, "map-zoom-phone-identity", "zoom_phone_user_map", crmUserId, null);
    return json({ data: { ok: true } });
  }
  return errorResponse("Method not allowed", 405);
}
__name(handleZoomPhoneMapping, "handleZoomPhoneMapping");

async function handleZoomDiagnostics(env) {
  // Access-gated, authenticated-CRM-user-only diagnostic endpoint. Confirms the
  // S2S OAuth helper works against real, safe, read-only Zoom endpoints. Never
  // returns the access token or any secret -- only HTTP status + counts.
  const out = { oauth: null, accountUsers: null, phoneUsers: null, phoneCallLogs: null };
  try {
    await getZoomAccessToken(env);
    out.oauth = { ok: true };
  } catch (e) {
    out.oauth = { ok: false, error: e.message };
    return json(out, 200);
  }
  try {
    const r0 = await zoomApiGet(env, "/users?page_size=1");
    out.accountUsers = { status: r0.status, ok: r0.ok, count: r0.body && typeof r0.body.total_records === "number" ? r0.body.total_records : null };
  } catch (e) {
    out.accountUsers = { ok: false, error: e.message };
  }
  try {
    const r1 = await zoomApiGet(env, "/phone/users?page_size=1");
    out.phoneUsers = { status: r1.status, ok: r1.ok, count: r1.body && typeof r1.body.total_records === "number" ? r1.body.total_records : null };
  } catch (e) {
    out.phoneUsers = { ok: false, error: e.message };
  }
  try {
    const r2 = await zoomApiGet(env, "/phone/call_logs?page_size=1");
    out.phoneCallLogs = { status: r2.status, ok: r2.ok, count: r2.body && typeof r2.body.total_records === "number" ? r2.body.total_records : null };
  } catch (e) {
    out.phoneCallLogs = { ok: false, error: e.message };
  }

  // Additive: meetings list + one meeting detail + one meeting summary, all
  // read-only, scoped to whichever Zoom user we can discover from the phone
  // users list above. Never returns PII beyond counts/ids/topics already
  // visible in the CRM's own Zoom Phone user list.
  out.meetings = null;
  out.meetingDetail = null;
  out.meetingSummary = null;
  try {
    const pu = await zoomApiGet(env, "/phone/users?page_size=1");
    const userId = pu.body && Array.isArray(pu.body.users) && pu.body.users[0] ? (pu.body.users[0].user_id || pu.body.users[0].id) : null;
    if (!userId) {
      out.meetings = { ok: false, error: "No Zoom user id available from phone/users to query meetings for" };
    } else {
      const rm = await zoomApiGet(env, `/users/${userId}/meetings?type=previous_meetings&page_size=1`);
      out.meetings = { status: rm.status, ok: rm.ok, count: rm.body && typeof rm.body.total_records === "number" ? rm.body.total_records : null };
      const firstMeeting = rm.body && Array.isArray(rm.body.meetings) ? rm.body.meetings[0] : null;
      if (firstMeeting && firstMeeting.id) {
        const rd = await zoomApiGet(env, `/meetings/${firstMeeting.id}`);
        out.meetingDetail = { status: rd.status, ok: rd.ok, hasTopic: !!(rd.body && rd.body.topic), hasStartTime: !!(rd.body && rd.body.start_time) };
        const rs = await zoomApiGet(env, `/meetings/${firstMeeting.id}/meeting_summary`);
        out.meetingSummary = { status: rs.status, ok: rs.ok, hasSummary: !!(rs.body && (rs.body.summary_overview || rs.body.summary_details)) };
      } else {
        out.meetingDetail = { ok: false, error: "No prior meetings found to query" };
        out.meetingSummary = { ok: false, error: "No prior meetings found to query" };
      }
    }
  } catch (e) {
    out.meetings = out.meetings || { ok: false, error: e.message };
  }

  return json(out, 200);
}
__name(handleZoomDiagnostics, "handleZoomDiagnostics");

// ===== end Zoom S2S OAuth + Webhook foundation =====


// ===== Zoho Mail OAuth + API integration =====
// Zoho remains source of truth for mail content. D1 keeps only lightweight
// integration state: OAuth tokens, the Zoho account id, and small
// cross-reference metadata (contact match, sent-by, sync cursor, claim) --
// never the mailbox itself.
var ZOHO_SCOPES = "ZohoMail.messages.ALL,ZohoMail.accounts.READ,ZohoMail.folders.READ";

async function getZohoOAuthRow(env, orgId) {
  return env.DB.prepare("SELECT * FROM zoho_oauth_tokens WHERE org_id = ?").bind(orgId).first();
}
__name(getZohoOAuthRow, "getZohoOAuthRow");

// Zoho Mail's REST API is NOT hosted on the generic api_domain returned by
// the OAuth token response (that domain -- e.g. www.zohoapis.com -- is for
// Zoho's general multi-service API gateway used by CRM/Books/etc. and
// returns 404 for /api/accounts and every other Mail endpoint). Zoho Mail
// has its own data-center-specific host, mail.zoho.<tld>, derived from the
// same data center as the accounts server captured at OAuth connect time
// (accounts.zoho.com -> mail.zoho.com, accounts.zoho.eu -> mail.zoho.eu,
// etc.). Verified live against the real connected mailbox.
function zohoMailApiDomain(accountsServer) {
  try {
    const host = new URL(accountsServer).host; // e.g. accounts.zoho.com
    const mailHost = host.replace(/^accounts\./, "mail.");
    return "https://" + mailHost;
  } catch (e) {
    return "https://mail.zoho.com";
  }
}
__name(zohoMailApiDomain, "zohoMailApiDomain");

async function getZohoAccessToken(env, orgId) {
  const row = await getZohoOAuthRow(env, orgId);
  if (!row) throw new Error("Zoho is not connected for this organization");
  const now = Date.now();
  const expMs = new Date(row.access_token_expires_at).getTime();
  if (Number.isFinite(expMs) && now < expMs - 6e4) {
    return { accessToken: row.access_token, apiDomain: row.api_domain, mailApiDomain: zohoMailApiDomain(row.accounts_server), accountId: row.zoho_account_id, accountsServer: row.accounts_server };
  }
  // Refresh. Uses the same data-center-specific accounts server captured at
  // connect time -- never assumed to be .com.
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET) {
    throw new Error("Zoho OAuth credentials are not configured");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: row.refresh_token
  });
  const resp = await fetch(`${row.accounts_server}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  const json2 = await resp.json().catch(() => null);
  if (!resp.ok || !json2 || !json2.access_token) {
    const detail = json2 ? JSON.stringify(json2).slice(0, 300) : `HTTP ${resp.status}`;
    throw new Error("Zoho token refresh failed: " + detail);
  }
  const newExpiresAt = new Date(Date.now() + (Number(json2.expires_in) || 3600) * 1e3).toISOString();
  const newApiDomain = json2.api_domain || row.api_domain;
  await env.DB.prepare(
    "UPDATE zoho_oauth_tokens SET access_token = ?, access_token_expires_at = ?, api_domain = COALESCE(?, api_domain), updated_at = ? WHERE org_id = ?"
  ).bind(json2.access_token, newExpiresAt, newApiDomain, isoNow(), orgId).run();
  return { accessToken: json2.access_token, apiDomain: newApiDomain, mailApiDomain: zohoMailApiDomain(row.accounts_server), accountId: row.zoho_account_id, accountsServer: row.accounts_server };
}
__name(getZohoAccessToken, "getZohoAccessToken");

async function zohoApiFetch(env, orgId, path, options) {
  const opts = options || {};
  const tok = await getZohoAccessToken(env, orgId);
  const resp = await fetch(`${tok.mailApiDomain}${path}`, {
    method: opts.method || "GET",
    headers: Object.assign(
      { "Authorization": `Zoho-oauthtoken ${tok.accessToken}` },
      opts.json ? { "Content-Type": "application/json" } : {},
      opts.headers || {}
    ),
    body: opts.json ? JSON.stringify(opts.json) : opts.body
  });
  let body = null;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    body = await resp.json().catch(() => null);
  }
  return { ok: resp.ok, status: resp.status, body, raw: ct.includes("application/json") ? null : resp };
}
__name(zohoApiFetch, "zohoApiFetch");

async function handleZohoOAuthStart(request, env, user) {
  if (!user.isOwner) return errorResponse("Forbidden: only Owner/Admin can connect Zoho Mail", 403);
  if (!env.ZOHO_CLIENT_ID) return errorResponse("Zoho OAuth is not configured", 503);
  const state = genId("zst").slice(0, 40);
  await env.DB.prepare(
    "INSERT INTO zoho_oauth_state (state, org_id, created_by, created_at) VALUES (?, ?, ?, ?)"
  ).bind(state, user.orgId, user.email || user.id || null, isoNow()).run();
  const redirectUri = "https://crm.sereneop.com/zoho/oauth/callback";
  const authUrl = "https://accounts.zoho.com/oauth/v2/auth?" + new URLSearchParams({
    scope: ZOHO_SCOPES,
    client_id: env.ZOHO_CLIENT_ID,
    response_type: "code",
    access_type: "offline",
    redirect_uri: redirectUri,
    state,
    prompt: "consent"
  }).toString();
  return Response.redirect(authUrl, 302);
}
__name(handleZohoOAuthStart, "handleZohoOAuthStart");

async function handleZohoOAuthCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const accountsServerRaw = url.searchParams.get("accounts-server");
  const errorParam = url.searchParams.get("error");
  if (errorParam) {
    return Response.redirect(`https://crm.sereneop.com/?zoho=error&reason=${encodeURIComponent(errorParam)}`, 302);
  }
  if (!code || !state) {
    return Response.redirect("https://crm.sereneop.com/?zoho=error&reason=missing_code_or_state", 302);
  }
  const stateRow = await env.DB.prepare("SELECT * FROM zoho_oauth_state WHERE state = ?").bind(state).first();
  if (!stateRow) {
    return Response.redirect("https://crm.sereneop.com/?zoho=error&reason=invalid_state", 302);
  }
  await env.DB.prepare("DELETE FROM zoho_oauth_state WHERE state = ?").bind(state).run();
  // Stale state (older than 10 minutes) is rejected rather than honored, in
  // case a link was reused or replayed long after the real authorization.
  const stateAgeMs = Date.now() - new Date(stateRow.created_at).getTime();
  if (!Number.isFinite(stateAgeMs) || stateAgeMs > 10 * 60 * 1e3) {
    return Response.redirect("https://crm.sereneop.com/?zoho=error&reason=expired_state", 302);
  }

  // Never assume .com: Zoho's own authorization response tells us which
  // data-center accounts server actually issued this code.
  const accountsServer = accountsServerRaw ? accountsServerRaw.replace(/\/$/, "") : "https://accounts.zoho.com";
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET) {
    return Response.redirect("https://crm.sereneop.com/?zoho=error&reason=not_configured", 302);
  }
  const redirectUri = "https://crm.sereneop.com/zoho/oauth/callback";
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    redirect_uri: redirectUri,
    code
  });
  const tokenResp = await fetch(`${accountsServer}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenBody.toString()
  });
  const tokenJson = await tokenResp.json().catch(() => null);
  if (!tokenResp.ok || !tokenJson || !tokenJson.access_token) {
    console.error("Zoho token exchange failed", tokenJson);
    return Response.redirect("https://crm.sereneop.com/?zoho=error&reason=token_exchange_failed", 302);
  }
  const apiDomain = tokenJson.api_domain || accountsServer;
  const expiresAt = new Date(Date.now() + (Number(tokenJson.expires_in) || 3600) * 1e3).toISOString();

  // Fetch the connected mailbox's account id + address (needed for every
  // subsequent Mail API call, and shown to the user as confirmation of
  // which mailbox got connected).
  let zohoAccountId = null, zohoEmail = null;
  try {
    const acctResp = await fetch(`${zohoMailApiDomain(accountsServer)}/api/accounts`, {
      headers: { "Authorization": `Zoho-oauthtoken ${tokenJson.access_token}` }
    });
    const acctJson = await acctResp.json().catch(() => null);
    const first = acctJson && Array.isArray(acctJson.data) ? acctJson.data[0] : null;
    if (first) {
      zohoAccountId = first.accountId || null;
      zohoEmail = first.primaryEmailAddress || first.mailboxAddress || null;
    }
  } catch (e) {
    console.error("Zoho account lookup after OAuth failed", e.message);
  }

  const now = isoNow();
  await env.DB.prepare(
    `INSERT INTO zoho_oauth_tokens (org_id, accounts_server, api_domain, zoho_account_id, zoho_email, access_token, refresh_token, access_token_expires_at, scope, connected_by, connected_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(org_id) DO UPDATE SET
       accounts_server = excluded.accounts_server,
       api_domain = excluded.api_domain,
       zoho_account_id = excluded.zoho_account_id,
       zoho_email = excluded.zoho_email,
       access_token = excluded.access_token,
       refresh_token = excluded.refresh_token,
       access_token_expires_at = excluded.access_token_expires_at,
       scope = excluded.scope,
       updated_at = excluded.updated_at`
  ).bind(
    stateRow.org_id, accountsServer, apiDomain, zohoAccountId, zohoEmail,
    tokenJson.access_token, tokenJson.refresh_token || null, expiresAt, tokenJson.scope || ZOHO_SCOPES,
    stateRow.created_by, now, now
  ).run();

  return Response.redirect("https://crm.sereneop.com/?zoho=connected", 302);
}
__name(handleZohoOAuthCallback, "handleZohoOAuthCallback");

async function handleZohoDisconnect(request, env, user) {
  if (!user.isOwner) return errorResponse("Forbidden: only Owner/Admin can disconnect Zoho Mail", 403);
  await env.DB.prepare("DELETE FROM zoho_oauth_tokens WHERE org_id = ?").bind(user.orgId).run();
  return json({ data: { ok: true } });
}
__name(handleZohoDisconnect, "handleZohoDisconnect");

async function handleZohoStatus(request, env, user) {
  const row = await getZohoOAuthRow(env, user.orgId);
  if (!row) return json({ data: { connected: false } });
  return json({ data: {
    connected: true,
    email: row.zoho_email,
    connectedBy: row.connected_by,
    connectedAt: row.connected_at
  } });
}
__name(handleZohoStatus, "handleZohoStatus");

async function requireZohoAccount(env, orgId) {
  const row = await getZohoOAuthRow(env, orgId);
  if (!row || !row.zoho_account_id) throw new Error("Zoho Mail is not connected");
  return row;
}
__name(requireZohoAccount, "requireZohoAccount");

async function handleZohoFolders(request, env, user) {
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders`);
    if (!result.ok) return errorResponse("Zoho folders request failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    return json({ data: (result.body && result.body.data) || [] });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoFolders, "handleZohoFolders");

async function handleZohoMessagesList(request, env, user) {
  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId");
  if (!folderId) return errorResponse("folderId is required", 400);
  const start = url.searchParams.get("start") || "1";
  const limit = url.searchParams.get("limit") || "25";
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const qs = new URLSearchParams({ folderId, start, limit, sortBy: "date", sortorder: "false" });
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages/view?${qs.toString()}`);
    if (!result.ok) return errorResponse("Zoho messages request failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    return json({ data: (result.body && result.body.data) || [] });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoMessagesList, "handleZohoMessagesList");

// Small CRM-side metadata layer for real Zoho messages -- claim/assignment
// state and CRM contact linking. Never mirrors mail content, just a thin
// cross-reference table keyed by the real Zoho message id.

// Records CRM-side attribution for a message the CRM itself sent via Zoho
// (new message, reply, reply-all, forward). Best-effort and non-blocking --
// never throws back to the caller, so a logging failure never breaks a real
// send. Does NOT duplicate the message content anywhere; only the Zoho
// message id, thread id, sending CRM user, and (if supplied) linked contact.
async function recordZohoSendAttribution(env, orgId, sentByEmail, contactId, folderId, responseData) {
  try {
    const d = responseData || {};
    const messageId = d.messageId || d.message_id || (Array.isArray(d) && d[0] && (d[0].messageId || d[0].message_id));
    if (!messageId) return;
    const threadId = d.threadId || d.thread_id || null;
    const now = isoNow();
    const existing = await env.DB.prepare("SELECT * FROM zoho_mail_meta WHERE org_id = ? AND zoho_message_id = ?").bind(orgId, String(messageId)).first();
    if (existing) {
      await env.DB.prepare("UPDATE zoho_mail_meta SET sent_by_crm_user_id = ?, thread_id = COALESCE(?, thread_id), matched_contact_id = COALESCE(?, matched_contact_id), zoho_folder_id = COALESCE(?, zoho_folder_id), updated_at = ? WHERE org_id = ? AND zoho_message_id = ?")
        .bind(sentByEmail, threadId, contactId || null, folderId || null, now, orgId, String(messageId)).run();
    } else {
      await env.DB.prepare("INSERT INTO zoho_mail_meta (id, org_id, zoho_message_id, zoho_folder_id, thread_id, matched_contact_id, sent_by_crm_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(genId("zmm"), orgId, String(messageId), folderId || null, threadId, contactId || null, sentByEmail, now, now).run();
    }
  } catch (e) {
    // Deliberately swallowed: attribution logging must never break a real send.
  }
}
__name(recordZohoSendAttribution, "recordZohoSendAttribution");

async function handleZohoMailMetaList(request, env, user) {
  const url = new URL(request.url);
  const folderId = url.searchParams.get("folderId");
  const rows = folderId
    ? await env.DB.prepare("SELECT * FROM zoho_mail_meta WHERE org_id = ? AND zoho_folder_id = ?").bind(user.orgId, folderId).all()
    : await env.DB.prepare("SELECT * FROM zoho_mail_meta WHERE org_id = ?").bind(user.orgId).all();
  const data = {};
  (rows.results || []).forEach(function(r) {
    data[r.zoho_message_id] = { contactId: r.matched_contact_id || null, claimedBy: r.claimed_by || null,
      sentBy: r.sent_by_crm_user_id || null, threadId: r.thread_id || null, createdAt: r.created_at || null };
  });
  return json({ data });
}
__name(handleZohoMailMetaList, "handleZohoMailMetaList");

async function handleZohoMailMetaPatch(request, env, user, messageId) {
  let body;
  try { body = await request.json(); } catch (e) { return errorResponse("Invalid JSON body", 400); }
  const now = isoNow();
  const existing = await env.DB.prepare("SELECT * FROM zoho_mail_meta WHERE org_id = ? AND zoho_message_id = ?").bind(user.orgId, messageId).first();
  const contactId = body && Object.prototype.hasOwnProperty.call(body, "contactId") ? body.contactId : (existing ? existing.matched_contact_id : null);
  const claimedBy = body && Object.prototype.hasOwnProperty.call(body, "claimedBy") ? body.claimedBy : (existing ? existing.claimed_by : null);
  const folderId = (body && body.folderId) || (existing ? existing.zoho_folder_id : null);
  if (existing) {
    await env.DB.prepare("UPDATE zoho_mail_meta SET matched_contact_id = ?, claimed_by = ?, zoho_folder_id = COALESCE(?, zoho_folder_id), updated_at = ? WHERE org_id = ? AND zoho_message_id = ?")
      .bind(contactId, claimedBy, folderId, now, user.orgId, messageId).run();
  } else {
    await env.DB.prepare("INSERT INTO zoho_mail_meta (id, org_id, zoho_message_id, zoho_folder_id, matched_contact_id, claimed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(genId("zmm"), user.orgId, messageId, folderId, contactId, claimedBy, now, now).run();
  }
  return json({ data: { messageId, contactId, claimedBy } });
}
__name(handleZohoMailMetaPatch, "handleZohoMailMetaPatch");

async function handleZohoMessageContent(request, env, user, folderId, messageId) {
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders/${folderId}/messages/${messageId}/content`);
    if (!result.ok) return errorResponse("Zoho message content request failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    const data = (result.body && result.body.data) || {};
    // Zoho's "content" endpoint only returns {messageId, content} -- it does
    // NOT include attachment info, even when hasAttachment is "1" on the
    // message (verified live on 2026-09-10). Attachment metadata lives on
    // the separate "attachmentinfo" endpoint; merged in here so the
    // frontend's existing `content.attachments` usage (message detail view,
    // download links) works without needing its own second fetch.
    try {
      const attResult = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders/${folderId}/messages/${messageId}/attachmentinfo`);
      const attList = attResult.ok && attResult.body && attResult.body.data && attResult.body.data.attachments;
      if (Array.isArray(attList)) {
        data.attachments = attList;
      }
    } catch (attErr) {
      // Best-effort: a missing/failed attachment listing should never break
      // rendering the message body itself.
    }
    return json({ data });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoMessageContent, "handleZohoMessageContent");

async function handleZohoMarkRead(request, env, user) {
  let body;
  try { body = await request.json(); } catch (e) { return errorResponse("Invalid JSON body", 400); }
  if (!body || !Array.isArray(body.messageIds) || !body.messageIds.length) {
    return errorResponse("messageIds (array) is required", 400);
  }
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/updatemessage`, {
      method: "PUT",
      json: { mode: body.read === false ? "markAsUnread" : "markAsRead", messageId: body.messageIds }
    });
    if (!result.ok) return errorResponse("Zoho mark-read request failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    return json({ data: { ok: true } });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoMarkRead, "handleZohoMarkRead");

async function handleZohoSend(request, env, user) {
  let body;
  try { body = await request.json(); } catch (e) { return errorResponse("Invalid JSON body", 400); }
  if (!body || !body.toAddress || !body.subject) return errorResponse("toAddress and subject are required", 400);
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const payload = {
      fromAddress: row.zoho_email,
      toAddress: body.toAddress,
      ccAddress: body.ccAddress || undefined,
      bccAddress: body.bccAddress || undefined,
      subject: body.subject,
      content: body.content || "",
      askReceipt: "no"
    };
    if (Array.isArray(body.attachments) && body.attachments.length) {
      payload.attachments = body.attachments
        .filter(function(a) { return a && a.attachmentPath && a.storeName; })
        .map(function(a) { return { storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName || "attachment" }; });
    }
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages`, { method: "POST", json: payload });
    if (!result.ok) return errorResponse("Zoho send failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    const sentData = (result.body && result.body.data) || { ok: true };
    await recordZohoSendAttribution(env, user.orgId, user.email || user.id || null, body.contactId || null, null, sentData);
    return json({ data: sentData });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoSend, "handleZohoSend");

async function handleZohoReplyOrForward(request, env, user, messageId) {
  let body;
  try { body = await request.json(); } catch (e) { return errorResponse("Invalid JSON body", 400); }
  const mode = body && body.mode;
  if (!["reply", "replyall", "forward"].includes(mode)) {
    return errorResponse("mode must be one of reply, replyall, forward", 400);
  }
  if (!body.toAddress) return errorResponse("toAddress is required", 400);
  try {
    const row = await requireZohoAccount(env, user.orgId);
    // Zoho's Mail API only reliably supports "action":"reply" on this
    // endpoint (POST /api/accounts/{id}/messages/{messageId}). Verified
    // live on 2026-09-10: a lowercase "forward" action crashes Zoho's
    // backend with a 500 Internal Error; a capitalized "Forward" is
    // rejected by their validator with PATTERN_NOT_MATCHED
    // ("zoho-inputstream ..."), regardless of payload shape (tried
    // fromAddress, subject, toAddress as string/array, form-encoded body).
    // "action":"reply" (lowercase) works reliably for any toAddress,
    // including addresses outside the original thread -- so Forward is
    // implemented on top of that same working call. This sends correctly
    // but does not carry Zoho's native forward-thread marker the way a
    // true forward would.
    const payload = {
      fromAddress: row.zoho_email,
      toAddress: body.toAddress,
      ccAddress: body.ccAddress || undefined,
      bccAddress: body.bccAddress || undefined,
      subject: body.subject || (mode === "forward" ? "Fwd: (no subject)" : "Re: (no subject)"),
      content: body.content || "",
      askReceipt: "no",
      action: "reply"
    };
    if (Array.isArray(body.attachments) && body.attachments.length) {
      payload.attachments = body.attachments
        .filter(function(a) { return a && a.attachmentPath && a.storeName; })
        .map(function(a) { return { storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName || "attachment" }; });
    }
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages/${messageId}`, { method: "POST", json: payload });
    if (!result.ok) return errorResponse("Zoho reply/forward failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    const rfData = (result.body && result.body.data) || { ok: true };
    await recordZohoSendAttribution(env, user.orgId, user.email || user.id || null, body.contactId || null, null, rfData);
    return json({ data: rfData });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoReplyOrForward, "handleZohoReplyOrForward");

// Zoho's Mail API has no in-place "update draft" endpoint (verified live
// 2026-09-10: POST .../messages/{id} always requires a reply/forward-style
// "action" and rejects mode:"draft" there; PUT on that path 404s). Every
// save therefore creates a fresh draft via POST .../messages with
// mode:"draft", and -- when editing an existing draft -- best-effort
// deletes (moves to trash, recoverable) the prior draft id so the Drafts
// folder never shows more than one live copy for that compose session.
// Zoho's attachmentinfo endpoint (used to list an existing message's
// attachments) only returns {attachmentId, attachmentName, attachmentSize}
// -- it never returns the storeName/attachmentPath pair the send/draft
// APIs require to re-attach a file. So carrying an attachment forward
// across a draft edit (which always creates a brand-new draft, see below)
// means re-fetching that attachment's bytes from the OLD draft and
// re-uploading them fresh to get a new storeName/attachmentPath the new
// draft can reference. Best-effort per attachment: one failing carry-over
// must never block saving the rest of the draft.
async function zohoCarryOverAttachment(env, orgId, accountId, item) {
  try {
    const tok = await getZohoAccessToken(env, orgId);
    const dlResp = await fetch(
      `${tok.mailApiDomain}/api/accounts/${accountId}/folders/${item.folderId}/messages/${item.messageId}/attachments/${item.attachmentId}`,
      { headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}` } }
    );
    if (!dlResp.ok) return null;
    const bytes = await dlResp.arrayBuffer();
    const fileName = item.attachmentName || "attachment";
    const upResp = await fetch(
      `${tok.mailApiDomain}/api/accounts/${accountId}/messages/attachments?${new URLSearchParams({ fileName, isInline: "false" }).toString()}`,
      { method: "POST", headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}`, "Content-Type": "application/octet-stream" }, body: bytes }
    );
    const upJson = await upResp.json().catch(() => null);
    if (!upResp.ok || !upJson || !upJson.data) return null;
    return { storeName: upJson.data.storeName, attachmentPath: upJson.data.attachmentPath, attachmentName: fileName };
  } catch (e) {
    return null;
  }
}
__name(zohoCarryOverAttachment, "zohoCarryOverAttachment");

async function handleZohoDraftSave(request, env, user) {
  let body;
  try { body = await request.json(); } catch (e) { return errorResponse("Invalid JSON body", 400); }
  if (!body || !body.toAddress) return errorResponse("toAddress is required", 400);
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const payload = {
      mode: "draft",
      fromAddress: row.zoho_email,
      toAddress: body.toAddress,
      ccAddress: body.ccAddress || undefined,
      bccAddress: body.bccAddress || undefined,
      subject: body.subject || "(No subject)",
      content: body.content || "",
      mailFormat: "html"
    };
    const attList = [];
    if (Array.isArray(body.attachments) && body.attachments.length) {
      body.attachments
        .filter(function(a) { return a && a.attachmentPath && a.storeName; })
        .forEach(function(a) { attList.push({ storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName || "attachment" }); });
    }
    if (Array.isArray(body.keepAttachments) && body.keepAttachments.length) {
      const carried = await Promise.all(body.keepAttachments
        .filter(function(a) { return a && a.folderId && a.messageId && a.attachmentId; })
        .map(function(a) { return zohoCarryOverAttachment(env, user.orgId, row.zoho_account_id, a); }));
      carried.filter(Boolean).forEach(function(a) { attList.push(a); });
    }
    if (attList.length) payload.attachments = attList;
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages`, { method: "POST", json: payload });
    if (!result.ok) return errorResponse("Zoho draft save failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    const draftData = (result.body && result.body.data) || {};
    if (body.draftId && body.draftFolderId && String(body.draftId) !== String(draftData.messageId)) {
      try {
        await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders/${body.draftFolderId}/messages/${body.draftId}`, { method: "DELETE" });
      } catch (delErr) {
        // Best-effort: the new draft already saved successfully; a failed
        // cleanup of the stale prior draft must never surface as an error.
      }
    }
    return json({ data: draftData });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoDraftSave, "handleZohoDraftSave");

// Sends an existing draft. Zoho has no documented "convert draft to sent"
// call, so this performs a real send (identical to New message) with the
// draft's current fields, then best-effort deletes the now-superseded
// draft. If the delete fails the mail has still genuinely sent -- a
// leftover draft copy is a much safer failure mode than a silently
// unsent message.
async function handleZohoDraftSend(request, env, user) {
  let body;
  try { body = await request.json(); } catch (e) { return errorResponse("Invalid JSON body", 400); }
  if (!body || !body.toAddress || !body.subject) return errorResponse("toAddress and subject are required", 400);
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const payload = {
      fromAddress: row.zoho_email,
      toAddress: body.toAddress,
      ccAddress: body.ccAddress || undefined,
      bccAddress: body.bccAddress || undefined,
      subject: body.subject,
      content: body.content || "",
      askReceipt: "no"
    };
    const attList2 = [];
    if (Array.isArray(body.attachments) && body.attachments.length) {
      body.attachments
        .filter(function(a) { return a && a.attachmentPath && a.storeName; })
        .forEach(function(a) { attList2.push({ storeName: a.storeName, attachmentPath: a.attachmentPath, attachmentName: a.attachmentName || "attachment" }); });
    }
    if (Array.isArray(body.keepAttachments) && body.keepAttachments.length) {
      const carried2 = await Promise.all(body.keepAttachments
        .filter(function(a) { return a && a.folderId && a.messageId && a.attachmentId; })
        .map(function(a) { return zohoCarryOverAttachment(env, user.orgId, row.zoho_account_id, a); }));
      carried2.filter(Boolean).forEach(function(a) { attList2.push(a); });
    }
    if (attList2.length) payload.attachments = attList2;
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages`, { method: "POST", json: payload });
    if (!result.ok) return errorResponse("Zoho draft send failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    const sentData = (result.body && result.body.data) || { ok: true };
    if (body.draftId && body.draftFolderId) {
      try {
        await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders/${body.draftFolderId}/messages/${body.draftId}`, { method: "DELETE" });
      } catch (delErr) {
        // Best-effort cleanup only; the send itself already succeeded.
      }
    }
    await recordZohoSendAttribution(env, user.orgId, user.email || user.id || null, body.contactId || null, null, sentData);
    return json({ data: sentData });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoDraftSend, "handleZohoDraftSend");

// Discards a draft: moves it to Trash (expunge=false), never a permanent
// delete, so an accidental discard stays recoverable from the mailbox.
async function handleZohoDraftDelete(request, env, user, folderId, draftId) {
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const result = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders/${folderId}/messages/${draftId}`, { method: "DELETE" });
    if (!result.ok) return errorResponse("Zoho draft delete failed: " + JSON.stringify(result.body).slice(0, 300), 502);
    return json({ data: { ok: true } });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoDraftDelete, "handleZohoDraftDelete");

// Zoho's real conversation identifier: a reply/forward carries a
// "threadId" field pointing at the root message's own messageId (the root
// message itself carries no threadId field). Zoho's search API does not
// support filtering by threadId server-side (verified live 2026-09-10:
// searchKey=threadid:<id> / threadId:<id> both silently ignore the filter
// and return an unfiltered recent-messages listing), so grouping a full
// conversation means fetching each of the account's main folders' own
// listings and filtering client-side (here, worker-side) for rows whose
// threadId equals the target, or whose own messageId IS the target (the
// thread's root message never carries a threadId of its own).
async function handleZohoThreadGet(request, env, user) {
  const url = new URL(request.url);
  const threadId = url.searchParams.get("threadId");
  if (!threadId) return errorResponse("threadId is required", 400);
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const foldersResult = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/folders`);
    const folders = (foldersResult.ok && foldersResult.body && foldersResult.body.data) || [];
    const mainFolders = folders.filter(function(f) { return ["Inbox", "Sent", "Drafts"].indexOf(f.folderType) > -1; });
    const perFolder = await Promise.all(mainFolders.map(async function(f) {
      const qs = new URLSearchParams({ folderId: f.folderId, start: "1", limit: "200", sortBy: "date", sortorder: "false" });
      const r = await zohoApiFetch(env, user.orgId, `/api/accounts/${row.zoho_account_id}/messages/view?${qs.toString()}`);
      const rows = (r.ok && r.body && r.body.data) || [];
      return rows.filter(function(m) { return String(m.threadId) === String(threadId) || String(m.messageId) === String(threadId); });
    }));
    const merged = [].concat.apply([], perFolder);
    merged.sort(function(a, b) { return Number(a.receivedTime || 0) - Number(b.receivedTime || 0); });
    return json({ data: merged, mailboxEmail: row.zoho_email });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoThreadGet, "handleZohoThreadGet");

async function handleZohoAttachmentDownload(request, env, user, folderId, messageId, attachmentId) {
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const tok = await getZohoAccessToken(env, user.orgId);
    const resp = await fetch(
      `${tok.mailApiDomain}/api/accounts/${row.zoho_account_id}/folders/${folderId}/messages/${messageId}/attachments/${attachmentId}`,
      { headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}` } }
    );
    if (!resp.ok) return errorResponse("Zoho attachment download failed", 502);
    return new Response(resp.body, {
      status: 200,
      headers: {
        "Content-Type": resp.headers.get("content-type") || "application/octet-stream",
        "Content-Disposition": resp.headers.get("content-disposition") || "attachment"
      }
    });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoAttachmentDownload, "handleZohoAttachmentDownload");

async function handleZohoAttachmentUpload(request, env, user) {
  try {
    const row = await requireZohoAccount(env, user.orgId);
    const tok = await getZohoAccessToken(env, user.orgId);
    const reqUrl = new URL(request.url);
    const fileName = reqUrl.searchParams.get("fileName") || "attachment";
    const attachQs = new URLSearchParams({ fileName, isInline: "false" });
    // Zoho's attachment-upload endpoint rejects any Content-Type other than
    // application/octet-stream with a 415 UNSUPPORTED_MEDIA_TYPE -- verified
    // live on 2026-09-10 (a plain text/plain upload was rejected; the same
    // bytes with Content-Type: application/octet-stream succeeded). It
    // determines the file type from the fileName extension, not the
    // Content-Type header, so the browser's real per-file MIME type is
    // deliberately never forwarded here.
    const resp = await fetch(`${tok.mailApiDomain}/api/accounts/${row.zoho_account_id}/messages/attachments?${attachQs.toString()}`, {
      method: "POST",
      headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}`, "Content-Type": "application/octet-stream" },
      body: request.body
    });
    const respJson = await resp.json().catch(() => null);
    if (!resp.ok) return errorResponse("Zoho attachment upload failed: " + JSON.stringify(respJson).slice(0, 300), 502);
    return json({ data: (respJson && respJson.data) || null });
  } catch (e) {
    return errorResponse(e.message, 409);
  }
}
__name(handleZohoAttachmentUpload, "handleZohoAttachmentUpload");

// ===== end Zoho Mail OAuth + API integration =====

// ===== Staging same-origin frontend proxy (added for staging-crm.sereneop.com) =====
// Serves the current zoom-zoho-integration Pages branch deployment for any
// non-API request on staging-crm.sereneop.com, so the staging frontend and
// this same Worker's real /api/* handlers share one origin. Never used for
// crm.sereneop.com (production keeps coming from the Pages custom domain
// untouched) and never touches /api/*, /zoom/webhook or /zoho/oauth/callback,
// which are already routed above this call.
var STAGING_FRONTEND_ORIGIN = "https://zoom-zoho-integration.serene-ops-crm.pages.dev";
// The pages.dev branch preview above is itself protected by its own
// Cloudflare Access application ("Serene Ops CRM (pages.dev)"). A plain
// server-side fetch carries no browser session, so without authenticating
// this request Access would hand back a 302 to ITS OWN login -- which, if
// passed through to the real browser, sends it into a second/third Access
// context it can't cleanly resolve (this is exactly what produced the
// "Invalid login session" error seen on staging-crm.sereneop.com). Fixed by
// authenticating this specific outbound fetch with a Cloudflare Access
// Service Token (see worker/README.md for how it's provisioned) scoped only
// to that pages.dev app's Service Auth policy -- unrelated to, and never
// mixed with, the production CRM Access app or its ACCESS_AUD list.
async function proxyStagingFrontend(request, url, env) {
  const target = STAGING_FRONTEND_ORIGIN + url.pathname + url.search;
  const headers = new Headers(request.headers);
  // Strip the browser's own Access session artifacts (its CF_Authorization
  // cookie and any cf-access-* header) before this server-side fetch. Those
  // were issued for the staging-crm.sereneop.com Access app, not the
  // pages.dev Access app being called here -- forwarding them let Access see
  // a mismatched/invalid identity assertion and reject the request before it
  // ever got to evaluate the Service Auth policy below. Only the service
  // token headers we set ourselves should authenticate this fetch.
  headers.delete("Cookie");
  headers.delete("cf-access-jwt-assertion");
  if (env && env.STAGING_PAGES_ACCESS_CLIENT_ID && env.STAGING_PAGES_ACCESS_CLIENT_SECRET) {
    headers.set("CF-Access-Client-Id", env.STAGING_PAGES_ACCESS_CLIENT_ID);
    headers.set("CF-Access-Client-Secret", env.STAGING_PAGES_ACCESS_CLIENT_SECRET);
  }
  try {
    const upstreamResp = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? void 0 : request.body,
      redirect: "manual"
    });
    // A 3xx/401/403 here means the Service Token isn't authorizing this
    // fetch against the pages.dev Access app (missing/wrong secrets, or the
    // Service Auth policy isn't attached yet) -- never forward an Access
    // login redirect to the real browser, that is the exact bug being fixed.
    if (upstreamResp.status >= 300 && upstreamResp.status < 400 || upstreamResp.status === 401 || upstreamResp.status === 403) {
      return errorResponse(
        "Staging proxy misconfigured: the Worker's request to the staging frontend was rejected by Cloudflare Access (status " + upstreamResp.status + "). The STAGING_PAGES_ACCESS_CLIENT_ID / STAGING_PAGES_ACCESS_CLIENT_SECRET Worker secrets are missing, wrong, or not yet authorized by the pages.dev app's Service Auth policy. See worker/README.md.",
        502
      );
    }
    return upstreamResp;
  } catch (err) {
    return errorResponse("Staging frontend proxy failed: " + err.message, 502);
  }
}
__name(proxyStagingFrontend, "proxyStagingFrontend");
// ===== end staging same-origin frontend proxy =====

var worker_default = { async fetch(e, r, t) {
  const _stagingUrl = new URL(e.url);
  const s = _stagingUrl.pathname;
  if ("OPTIONS" === e.method) return new Response(null, { status: 204, headers: corsHeaders(e) });
  if ("/api/health" === s) return withCors(json({ status: "ok", time: isoNow() }), e);
  if ("/zoom/webhook" === s) return handleZoomWebhook(e, r);
  if ("/zoho/oauth/callback" === s) return handleZohoOAuthCallback(e, r);
  // Same-origin staging hostname: everything that is NOT an /api/* call (and
  // not the two public exceptions above) is served by proxying the current
  // zoom-zoho-integration Pages branch deployment server-side, so the
  // staging frontend and its API share one origin (crm.sereneop.com's
  // production frontend is untouched -- it still comes from the Pages
  // custom domain, not this Worker).
  if (_stagingUrl.hostname === "staging-crm.sereneop.com" && !s.startsWith("/api/") && !s.startsWith("/cdn-cgi/")) {
    return proxyStagingFrontend(e, _stagingUrl, r);
  }
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
  if ("/api/zoho/oauth/start" === s && "GET" === e.method) {
    return await handleZohoOAuthStart(e, r, n);
  }
  if ("/api/zoho/disconnect" === s && "POST" === e.method) {
    return withCors(await handleZohoDisconnect(e, r, n), e);
  }
  if ("/api/zoho/status" === s && "GET" === e.method) {
    return withCors(await handleZohoStatus(e, r, n), e);
  }
  if ("/api/zoho/mail/folders" === s && "GET" === e.method) {
    return withCors(await handleZohoFolders(e, r, n), e);
  }
  if ("/api/zoho/mail/messages" === s && "GET" === e.method) {
    return withCors(await handleZohoMessagesList(e, r, n), e);
  }
  if ("/api/zoho/mail/messages/mark-read" === s && "PUT" === e.method) {
    return withCors(await handleZohoMarkRead(e, r, n), e);
  }
  if ("/api/zoho/mail/send" === s && "POST" === e.method) {
    return withCors(await handleZohoSend(e, r, n), e);
  }
  if ("/api/zoho/mail/meta" === s && "GET" === e.method) {
    return withCors(await handleZohoMailMetaList(e, r, n), e);
  }
  if (s.startsWith("/api/zoho/mail/meta/") && "PATCH" === e.method) {
    const metaMsgId = s.slice("/api/zoho/mail/meta/".length);
    if (!metaMsgId) return withCors(errorResponse("Not found", 404), e);
    return withCors(await handleZohoMailMetaPatch(e, r, n, metaMsgId), e);
  }
  if (s.startsWith("/api/zoho/mail/messages/") && s.endsWith("/action") && "POST" === e.method) {
    const parts0 = s.split("/");
    const messageId0 = parts0[5];
    if (!messageId0) return withCors(errorResponse("Not found", 404), e);
    return withCors(await handleZohoReplyOrForward(e, r, n, messageId0), e);
  }
  if (s.startsWith("/api/zoho/mail/attachments/") && "GET" === e.method) {
    const parts1 = s.slice("/api/zoho/mail/attachments/".length).split("/");
    const [folderId1, messageId1, attachmentId1] = parts1;
    if (!folderId1 || !messageId1 || !attachmentId1) return withCors(errorResponse("Not found", 404), e);
    return await handleZohoAttachmentDownload(e, r, n, folderId1, messageId1, attachmentId1);
  }
  if ("/api/zoho/mail/attachments/upload" === s && "POST" === e.method) {
    return withCors(await handleZohoAttachmentUpload(e, r, n), e);
  }
  if (s.startsWith("/api/zoho/mail/messages/") && "GET" === e.method) {
    const parts2 = s.slice("/api/zoho/mail/messages/".length).split("/");
    const [folderId2, messageId2] = parts2;
    if (!folderId2 || !messageId2) return withCors(errorResponse("Not found", 404), e);
    return withCors(await handleZohoMessageContent(e, r, n, folderId2, messageId2), e);
  }
  if ("/api/zoho/mail/draft" === s && "POST" === e.method) {
    return withCors(await handleZohoDraftSave(e, r, n), e);
  }
  if ("/api/zoho/mail/draft/send" === s && "POST" === e.method) {
    return withCors(await handleZohoDraftSend(e, r, n), e);
  }
  if ("/api/zoho/mail/thread" === s && "GET" === e.method) {
    return withCors(await handleZohoThreadGet(e, r, n), e);
  }
  if (s.startsWith("/api/zoho/mail/draft/") && "DELETE" === e.method) {
    const draftParts = s.slice("/api/zoho/mail/draft/".length).split("/");
    const [draftFolderId3, draftId3] = draftParts;
    if (!draftFolderId3 || !draftId3) return withCors(errorResponse("Not found", 404), e);
    return withCors(await handleZohoDraftDelete(e, r, n, draftFolderId3, draftId3), e);
  }
  if ("/api/zoom/diagnostics" === s && "GET" === e.method) {
    return withCors(await handleZoomDiagnostics(r), e);
  }
  if ("/api/zoom/phone-mapping" === s) {
    return withCors(await handleZoomPhoneMapping(e, r, n), e);
  }
  if (s.startsWith("/api/zoom/meetings/") && "PATCH" === e.method) {
    const zoomMeetingId = s.slice("/api/zoom/meetings/".length);
    if (!zoomMeetingId) return withCors(errorResponse("Not found", 404), e);
    return withCors(await handleZoomMeetingPatch(e, r, n, zoomMeetingId), e);
  }
  if ("/api/zoom/phone-users" === s && "GET" === e.method) {
    if (!n.isOwner) return withCors(errorResponse("Forbidden: only Owner/Admin can list Zoom Phone users", 403), e);
    return withCors(json(await handleZoomPhoneUsers(r)), e);
  }
  // Owner-only read-only diagnostic: calls Zoom's own
  // GET /past_meetings/{meetingId}/instances directly and returns the raw
  // result, so a real occurrence-uuid question can be checked against
  // Zoom's API on demand instead of guessing. Never writes anything.
  if (s.startsWith("/api/zoom/diagnostics/meeting-instances/") && "GET" === e.method) {
    if (!n.isOwner) return withCors(errorResponse("Forbidden: only Owner/Admin can run this", 403), e);
    const meetingId = s.slice("/api/zoom/diagnostics/meeting-instances/".length);
    if (!meetingId) return withCors(errorResponse("Not found", 404), e);
    try {
      const result = await zoomApiGet(r, `/past_meetings/${meetingId}/instances`);
      return withCors(json({ data: result }), e);
    } catch (err) {
      return withCors(errorResponse("Zoom API call failed: " + err.message, 502), e);
    }
  }
  // Standing owner-only repair tool: replays already-real, already-stored
  // zoom_meetings ledger rows into zoom_crm_meetings (the table merged into
  // /api/db at read time). Safe to keep -- idempotent, touches only rows
  // Zoom itself already delivered, never invents data. Useful if
  // zoom_crm_meetings ever needs reseeding from the ledger.
  if ("/api/zoom/diagnostics/backfill-meeting-sync" === s && "POST" === e.method) {
    if (!n.isOwner) return withCors(errorResponse("Forbidden: only Owner/Admin can run this", 403), e);
    return withCors(json(await backfillMeetingSyncFromLedger(r, n.orgId)), e);
  }
  // Owner-only diagnostic: fetches the raw Zoho /api/accounts response using
  // the org's currently stored Zoho token, with no parsing applied. Used to
  // see Zoho's real field names/shape when zoho_account_id/zoho_email end up
  // null after OAuth. Never writes anything.
  if ("/api/zoho/diagnostics/accounts-raw" === s && "GET" === e.method) {
    if (!n.isOwner) return withCors(errorResponse("Forbidden: only Owner/Admin can run this", 403), e);
    try {
      const tok = await getZohoAccessToken(r, n.orgId);
      const hostOverride = new URL(e.url).searchParams.get("host");
      const baseHost = hostOverride || tok.mailApiDomain;
      const resp = await fetch(`${baseHost}/api/accounts`, { headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}` } });
      const bodyText = await resp.text();
      return withCors(json({ status: resp.status, baseHost, body: bodyText.slice(0, 4000) }), e);
    } catch (err) {
      return withCors(errorResponse("Zoho accounts lookup failed: " + err.message, 502), e);
    }
  }
  // Owner-only repair tool: re-fetches the Zoho account id/email using the
  // org's already-stored, already-real OAuth token and updates
  // zoho_oauth_tokens. Safe to keep -- idempotent, never invents data, only
  // corrects a parsing bug from the initial OAuth callback. No new consent
  // needed since it reuses the existing refresh token.
  if ("/api/zoho/diagnostics/backfill-account-info" === s && "POST" === e.method) {
    if (!n.isOwner) return withCors(errorResponse("Forbidden: only Owner/Admin can run this", 403), e);
    try {
      const tok = await getZohoAccessToken(r, n.orgId);
      const resp = await fetch(`${tok.mailApiDomain}/api/accounts`, { headers: { "Authorization": `Zoho-oauthtoken ${tok.accessToken}` } });
      const acctJson = await resp.json().catch(() => null);
      const list = acctJson && (Array.isArray(acctJson.data) ? acctJson.data : (Array.isArray(acctJson) ? acctJson : null));
      const first = list && list[0];
      if (!first) return withCors(errorResponse("Zoho accounts response had no usable account entry: " + JSON.stringify(acctJson).slice(0, 300), 502), e);
      const accountId = first.accountId || first.account_id || null;
      const email = first.primaryEmailAddress || first.mailboxAddress || first.mailBoxAddress || first.emailAddress || first.email || null;
      if (!accountId) return withCors(errorResponse("Could not find accountId in Zoho response: " + JSON.stringify(first).slice(0, 300), 502), e);
      await r.DB.prepare("UPDATE zoho_oauth_tokens SET zoho_account_id = ?, zoho_email = ?, updated_at = ? WHERE org_id = ?")
        .bind(accountId, email, isoNow(), n.orgId).run();
      return withCors(json({ data: { accountId, email } }), e);
    } catch (err) {
      return withCors(errorResponse("Zoho account backfill failed: " + err.message, 502), e);
    }
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
