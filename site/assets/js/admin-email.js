const el = (id) => document.getElementById(id);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const status = el('emailStatus');
async function refresh() {
  status.textContent = 'Loading verified email activity…';
  const eventId = el('emailEvent').value;
  try {
    const response = await fetch('/api/admin/email-health?eventId=' + encodeURIComponent(eventId), { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) {
      el('emailPanel').classList.add('hidden');
      el('loginNote').classList.remove('hidden');
      return;
    }
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Unable to load email health');
    el('loginNote').classList.add('hidden');
    el('emailPanel').classList.remove('hidden');
    const s = data.summary;
    el('emailSummary').innerHTML = [
      ['Tracked', s.total], ['Delivered', s.delivered], ['Pending', s.awaitingProvider],
      ['Delayed', s.delayed], ['Failures', s.failed], ['Retries due', s.retriesDue]
    ].map(([name, count]) => '<div class="ops-metric"><strong>' + Number(count || 0) + '</strong><span>' + escape(name) + '</span></div>').join('');
    el('emailRows').innerHTML = data.messages.length ? data.messages.map((m) =>
      '<article class="ops-row"><div class="ops-row-main"><strong>' + escape(m.kind) + '</strong><span>' +
      escape(m.recipient) + '</span></div><span class="ops-status">' + escape(m.status) +
      '</span><div class="ops-row-meta"><span>' + escape(m.subject) + '</span><span>' +
      escape(m.updatedAt ? new Date(m.updatedAt).toLocaleString() : 'Unknown') +
      ' · Attempts ' + Number(m.attempts || 0) + '</span>' +
      (m.error ? '<span>' + escape(m.error) + '</span>' : '') + '</div></article>'
    ).join('') : '<div class="empty-state">No messages have been tracked for this realm yet.</div>';
    status.textContent = 'Showing ' + data.messages.length + ' recent events. Delivery is confirmed only for messages marked delivered.';
  } catch (error) { status.textContent = error.message; }
}
el('emailEvent').addEventListener('change', refresh);
el('emailRefresh').addEventListener('click', refresh);
refresh();
