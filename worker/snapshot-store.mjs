// Snapshot autosaves must compare the version originally read by the caller.
// The conditional SQL write also rejects a second save that raced the first.
import {checkedSnapshot} from './contact-integrity.mjs';
import {encodeSnapshot} from './snapshot-codec.mjs';
export const snapshotEtag = row => JSON.stringify(row?.updated_at ?? 'empty');

export function checkSnapshotRevision(request, row) {
  const supplied = request.headers.get('If-Match');
  if (!supplied) return {status: 428, error: 'Reload the CRM before saving. Your workspace version is missing.'};
  if (supplied !== snapshotEtag(row)) return {status: 409, error: 'This workspace changed in another window. Reload before saving to keep everyone’s updates.', updatedAt: row?.updated_at ?? null};
  return null;
}

export async function writeSnapshot(env, orgId, data, userId, previous) {
  data = await encodeSnapshot(await checkedSnapshot(data,previous));
  // Ensure every successful write changes the token, including rapid autosaves.
  const previousTime = Date.parse(previous?.updated_at || '') || 0;
  const stamp = new Date(Math.max(Date.now(), previousTime + 1)).toISOString();
  const saved = previous
    ? await env.DB.prepare('UPDATE crm_snapshot SET data=?,updated_at=?,updated_by=? WHERE org_id=? AND updated_at IS ?').bind(data, stamp, userId, orgId, previous.updated_at ?? null).run()
    : await env.DB.prepare('INSERT INTO crm_snapshot (org_id,data,updated_at,updated_by) VALUES (?,?,?,?) ON CONFLICT(org_id) DO NOTHING').bind(orgId, data, stamp, userId).run();
  if (!saved.meta?.changes) return null;
  return stamp;
}
