// Deterministic layout-only regrouping for the manual "group by" controls (§6.4).
// Operates on the session's in-memory records — no re-fetch, no LLM round-trip.
// The agent owns free-form grouping at query time; these four axes are the
// mutable-representation controls.

const MAX_GROUPS = 12;

function bucketOf(record, axis) {
  switch (axis) {
    case 'year': {
      if (record.year == null) return 'Undated';
      return `${Math.floor(record.year / 10) * 10}s`;
    }
    case 'department':
      return record.department || 'Unknown department';
    case 'artist':
      return record.artist || 'Unknown / unattributed';
    case 'medium': {
      // Medium strings are long and near-unique ("silk, metal thread, ...").
      // First comma/semicolon segment keeps cardinality sane.
      const head = (record.medium || 'Unknown medium').split(/[,;]/)[0].trim();
      return head.charAt(0).toUpperCase() + head.slice(1);
    }
    case 'source':
      return record.museum || 'Unknown source';
    default:
      return 'All results';
  }
}

export const MANUAL_AXES = ['year', 'source', 'department', 'artist', 'medium'];

export function groupRecords(records, axis) {
  const buckets = new Map();
  for (const r of records) {
    const label = bucketOf(r, axis);
    if (!buckets.has(label)) buckets.set(label, []);
    buckets.get(label).push(r.id);
  }

  let groups = [...buckets.entries()].map(([groupLabel, objectIDs]) => ({
    groupLabel,
    objectIDs,
  }));

  if (axis === 'year') {
    groups.sort((a, b) => {
      if (a.groupLabel === 'Undated') return 1;
      if (b.groupLabel === 'Undated') return -1;
      return parseInt(a.groupLabel) - parseInt(b.groupLabel);
    });
  } else {
    groups.sort((a, b) => b.objectIDs.length - a.objectIDs.length);
    if (groups.length > MAX_GROUPS) {
      const keep = groups.slice(0, MAX_GROUPS - 1);
      const rest = groups.slice(MAX_GROUPS - 1);
      keep.push({
        groupLabel: 'Other',
        objectIDs: rest.flatMap((g) => g.objectIDs),
      });
      groups = keep;
    }
  }

  return { axis, groups };
}
