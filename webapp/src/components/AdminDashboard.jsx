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

export default function AdminDashboard() {
  const token = useAdminToken();
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
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, page, pageSize]);

  // Ensure listing shows all users by default and when search is cleared
  useEffect(() => {
    if (token && search === '') {
      setPage(1);
      loadUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, search]);

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
    </div>
  );
}


