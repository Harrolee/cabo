import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { supabase } from '../main';

const FUNCTIONS_BASE_URL = import.meta.env.VITE_GCP_FUNCTION_BASE_URL || import.meta.env.VITE_GCP_FUNCTIONS_URL; // e.g. https://us-central1-<project>.cloudfunctions.net
const ADMIN_API_URL = FUNCTIONS_BASE_URL ? `${FUNCTIONS_BASE_URL}/admin-api` : null;

function useAdminToken() {
  const [token, setToken] = useState(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setToken(data?.session?.access_token || null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setToken(session?.access_token || null);
    });
    return () => subscription.unsubscribe();
  }, []);
  return token;
}

function Table({ columns, rows, onRowClick }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((c) => (
              <th key={c.key} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.map((r) => (
            <tr key={r.phone_number} className="hover:bg-gray-50 cursor-pointer" onClick={() => onRowClick?.(r)}>
              {columns.map((c) => (
                <td key={`${r.phone_number}-${c.key}`} className="px-3 py-2 text-sm text-gray-700">
                  {c.render ? c.render(r[c.key], r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CREATOR_STATUS_STYLE = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  suspended: 'bg-red-100 text-red-800',
};

/**
 * Creator approval. The status, revenue share and payout columns are all
 * restored by a database trigger on any write that carries an end-user JWT, so
 * every action here goes through the admin Cloud Function, which holds the
 * service role key server-side. Nothing on this page could work from the
 * browser's Supabase client, and that is deliberate.
 */
function CreatorsPanel({ callAdmin }) {
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [busyId, setBusyId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [coaches, setCoaches] = useState([]);
  const [shareDraft, setShareDraft] = useState({});

  async function loadCreators() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: '100' });
      if (statusFilter) params.set('status', statusFilter);
      if (search) params.set('search', search);
      const data = await callAdmin(`/creators?${params.toString()}`);
      setCreators(data.creators || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load creators');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCreators();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function openCreator(creator) {
    if (expanded === creator.id) {
      setExpanded(null);
      return;
    }
    setExpanded(creator.id);
    setCoaches([]);
    try {
      const data = await callAdmin(`/creators/${creator.id}/coaches`);
      setCoaches(data.coaches || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load this creator’s coaches');
    }
  }

  async function patchCreator(creator, body, successMessage) {
    setBusyId(creator.id);
    try {
      const updated = await callAdmin(`/creators/${creator.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const changed = updated.coaches_changed || [];
      toast.success(
        changed.length > 0
          ? `${successMessage} ${changed.length} coach${changed.length === 1 ? '' : 'es'} ${
              updated.status === 'approved' ? 'published to the roster' : 'taken off the roster'
            }.`
          : successMessage
      );
      await loadCreators();
      if (expanded === creator.id) {
        const data = await callAdmin(`/creators/${creator.id}/coaches`);
        setCoaches(data.coaches || []);
      }
    } catch (e) {
      console.error(e);
      toast.error('Update failed');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border px-3 py-2 rounded"
        >
          <option value="pending">Pending review</option>
          <option value="approved">Approved</option>
          <option value="suspended">Suspended</option>
          <option value="">All</option>
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') loadCreators(); }}
          placeholder="Search name, handle, or email"
          className="border px-3 py-2 rounded w-72"
        />
        <button onClick={loadCreators} className="bg-blue-600 text-white px-4 py-2 rounded">Search</button>
      </div>

      {loading ? (
        <div className="p-4 border rounded">Loading…</div>
      ) : creators.length === 0 ? (
        <div className="p-6 border rounded text-sm text-gray-500">
          No creators {statusFilter ? `with status "${statusFilter}"` : ''}.
        </div>
      ) : (
        <div className="space-y-3">
          {creators.map((creator) => (
            <div key={creator.id} className="border rounded">
              <div className="p-4 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[220px]">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{creator.display_name}</span>
                    <span className="text-sm text-gray-500">/creators/{creator.slug}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CREATOR_STATUS_STYLE[creator.status] || 'bg-gray-100 text-gray-700'}`}>
                      {creator.status}
                    </span>
                  </div>
                  <div className="text-sm text-gray-600">{creator.user_email}</div>
                  {creator.coach_counts && (
                    <div className="text-xs text-gray-500 mt-1">
                      {creator.coach_counts.total} coach{creator.coach_counts.total === 1 ? '' : 'es'}
                      {creator.coach_counts.in_review > 0 && ` · ${creator.coach_counts.in_review} awaiting listing`}
                      {creator.coach_counts.listed > 0 && ` · ${creator.coach_counts.listed} listed`}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500">Share %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={shareDraft[creator.id] ?? Math.round(creator.revenue_share_bps / 100)}
                    onChange={(e) => setShareDraft((p) => ({ ...p, [creator.id]: e.target.value }))}
                    className="border px-2 py-1 rounded w-16"
                  />
                  <button
                    disabled={busyId === creator.id}
                    onClick={() => patchCreator(
                      creator,
                      { revenue_share_bps: Math.round(Number(shareDraft[creator.id] ?? creator.revenue_share_bps / 100) * 100) },
                      'Revenue share updated.'
                    )}
                    className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                  >
                    Save
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {creator.status !== 'approved' && (
                    <button
                      disabled={busyId === creator.id}
                      onClick={() => patchCreator(creator, { status: 'approved' }, `${creator.display_name} approved.`)}
                      className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  {creator.status !== 'suspended' && (
                    <button
                      disabled={busyId === creator.id}
                      onClick={() => patchCreator(creator, { status: 'suspended' }, `${creator.display_name} suspended.`)}
                      className="bg-red-100 text-red-700 px-4 py-2 rounded disabled:opacity-50"
                    >
                      Suspend
                    </button>
                  )}
                  <button onClick={() => openCreator(creator)} className="px-3 py-2 border rounded text-sm">
                    {expanded === creator.id ? 'Hide' : 'Details'}
                  </button>
                </div>
              </div>

              {expanded === creator.id && (
                <div className="border-t p-4 bg-gray-50 space-y-3 text-sm">
                  {creator.bio && <p className="text-gray-700 whitespace-pre-line">{creator.bio}</p>}
                  {creator.website_url && (
                    <a href={creator.website_url} target="_blank" rel="noreferrer" className="text-blue-600 underline">
                      {creator.website_url}
                    </a>
                  )}
                  {creator.social_links && Object.keys(creator.social_links).length > 0 && (
                    <div className="flex flex-wrap gap-3 text-gray-600">
                      {Object.entries(creator.social_links).map(([key, value]) => (
                        <span key={key}><span className="capitalize text-gray-500">{key}:</span> {value}</span>
                      ))}
                    </div>
                  )}
                  <div>
                    <h4 className="font-medium mb-1">Coaches</h4>
                    {coaches.length === 0 ? (
                      <div className="text-gray-500">None yet.</div>
                    ) : (
                      <ul className="divide-y bg-white border rounded">
                        {coaches.map((coach) => (
                          <li key={coach.id} className="px-3 py-2 flex justify-between">
                            <span>
                              {coach.name} <span className="text-gray-500">@{coach.handle}</span>
                              {coach.discipline && <span className="text-gray-400"> — {coach.discipline}</span>}
                            </span>
                            <span className="text-gray-600 capitalize">{(coach.listing_status || 'draft').replace('_', ' ')}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  const token = useAdminToken();
  const [tab, setTab] = useState('users');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(25);
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [selectedUser, setSelectedUser] = useState(null);
  const [chat, setChat] = useState([]);
  const [saving, setSaving] = useState(false);

  const columns = useMemo(() => ([
    { key: 'full_name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone_number', label: 'Phone' },
    { key: 'coach', label: 'Coach' },
    { key: 'spice_level', label: 'Spice' },
    { key: 'image_preference', label: 'Image Pref' },
    { key: 'active', label: 'Active', render: (v) => (v ? 'Yes' : 'No') },
    { key: 'subscription_status', label: 'Sub Status', render: (_v, row) => row.subscriptions?.[0]?.status || '' },
  ]), []);

  async function callAdmin(path, options = {}) {
    if (!ADMIN_API_URL) throw new Error('VITE_GCP_FUNCTION_BASE_URL (or VITE_GCP_FUNCTIONS_URL) is not set');
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
    const res = await fetch(`${ADMIN_API_URL}${path}`, { ...options, headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    return res.json();
  }

  async function loadUsers() {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      const data = await callAdmin(`/users?${params.toString()}`);
      setUsers(data.users || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      loadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page, pageSize]);

  async function openUser(u) {
    setSelectedUser(u);
    setChat([]);
    try {
      const detail = await callAdmin(`/users/${encodeURIComponent(u.phone_number)}`);
      setSelectedUser(detail);
      const chatResp = await callAdmin(`/users/${encodeURIComponent(u.phone_number)}/chat`);
      setChat(chatResp.conversation || []);
    } catch (e) {
      console.error(e);
      toast.error('Failed to load user details');
    }
  }

  async function saveUser() {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const payload = {
        full_name: selectedUser.full_name,
        spice_level: selectedUser.spice_level,
        coach: selectedUser.coach,
        coach_type: selectedUser.coach_type,
        custom_coach_id: selectedUser.custom_coach_id,
        image_preference: selectedUser.image_preference,
        active: selectedUser.active,
      };
      await callAdmin(`/users/${encodeURIComponent(selectedUser.phone_number)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      toast.success('Saved');
      loadUsers();
    } catch (e) {
      console.error(e);
      toast.error('Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold">Admin Dashboard</h1>

      <div className="flex gap-2 border-b">
        {[['users', 'Users'], ['creators', 'Creators']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 -mb-px border-b-2 font-medium ${
              tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'creators' ? (
        token ? <CreatorsPanel callAdmin={callAdmin} /> : <div className="p-4">Loading…</div>
      ) : (
      <>
      <div className="flex items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, or phone"
          className="border px-3 py-2 rounded w-80"
        />
        <button onClick={() => { setPage(1); loadUsers(); }} className="bg-blue-600 text-white px-4 py-2 rounded">Search</button>
      </div>
      <div className="border rounded">
        {loading ? (
          <div className="p-4">Loading...</div>
        ) : (
          <Table columns={columns} rows={users} onRowClick={openUser} />
        )}
      </div>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="px-3 py-1 border rounded disabled:opacity-50">Prev</button>
        <div>Page {page} of {Math.max(1, Math.ceil(total / pageSize))}</div>
        <button disabled={page >= Math.ceil(total / pageSize)} onClick={() => setPage((p) => p + 1)} className="px-3 py-1 border rounded disabled:opacity-50">Next</button>
      </div>

      {selectedUser && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border rounded p-4 space-y-3">
            <h2 className="font-semibold text-lg">User Details</h2>
            <div className="grid grid-cols-2 gap-2 items-center">
              <label className="text-sm text-gray-600">Full Name</label>
              <input value={selectedUser.full_name || ''} onChange={(e) => setSelectedUser({ ...selectedUser, full_name: e.target.value })} className="border px-2 py-1 rounded" />

              <label className="text-sm text-gray-600">Phone</label>
              <input disabled value={selectedUser.phone_number || ''} className="border px-2 py-1 rounded bg-gray-100" />

              <label className="text-sm text-gray-600">Email</label>
              <input disabled value={selectedUser.email || ''} className="border px-2 py-1 rounded bg-gray-100" />

              <label className="text-sm text-gray-600">Coach</label>
              <input value={selectedUser.coach || ''} onChange={(e) => setSelectedUser({ ...selectedUser, coach: e.target.value })} className="border px-2 py-1 rounded" />

              <label className="text-sm text-gray-600">Coach Type</label>
              <select value={selectedUser.coach_type || 'predefined'} onChange={(e) => setSelectedUser({ ...selectedUser, coach_type: e.target.value })} className="border px-2 py-1 rounded">
                <option value="predefined">predefined</option>
                <option value="custom">custom</option>
              </select>

              <label className="text-sm text-gray-600">Custom Coach ID</label>
              <input value={selectedUser.custom_coach_id || ''} onChange={(e) => setSelectedUser({ ...selectedUser, custom_coach_id: e.target.value })} className="border px-2 py-1 rounded" />

              <label className="text-sm text-gray-600">Spice Level</label>
              <input type="number" value={selectedUser.spice_level ?? ''} onChange={(e) => setSelectedUser({ ...selectedUser, spice_level: e.target.valueAsNumber })} className="border px-2 py-1 rounded" />

              <label className="text-sm text-gray-600">Image Preference</label>
              <input value={selectedUser.image_preference || ''} onChange={(e) => setSelectedUser({ ...selectedUser, image_preference: e.target.value })} className="border px-2 py-1 rounded" />

              <label className="text-sm text-gray-600">Active</label>
              <input type="checkbox" checked={!!selectedUser.active} onChange={(e) => setSelectedUser({ ...selectedUser, active: e.target.checked })} />
            </div>
            <div className="flex gap-2">
              <button onClick={saveUser} disabled={saving} className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
              <button onClick={() => setSelectedUser(null)} className="px-4 py-2 rounded border">Close</button>
            </div>
          </div>

          <div className="border rounded p-4 space-y-3">
            <h2 className="font-semibold text-lg">Chat History</h2>
            <div className="h-96 overflow-auto border rounded">
              {chat.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">No messages</div>
              ) : (
                <ul className="divide-y">
                  {chat.map((m, idx) => (
                    <li key={idx} className="p-2">
                      <div className="text-xs text-gray-500">{m.timestamp} — {m.role}</div>
                      <div className="whitespace-pre-wrap text-sm">{m.content}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}


