// Pending / approved / rejected pill, shared by the tutor's own views and the
// admin Approvals queue.
export default function StatusBadge({ status }) {
  const bg = status === 'approved' ? 'var(--accent-green)'
    : status === 'rejected' ? 'var(--error)' : 'var(--warn)';
  return <span className="badge" style={{ background: bg }}>{status}</span>;
}
