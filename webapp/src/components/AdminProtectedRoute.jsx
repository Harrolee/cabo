import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase } from '../main';

function isAdminUserClient(session) {
  if (!session || !session.user) return false;
  const adminEmails = (import.meta.env.VITE_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const adminPhones = (import.meta.env.VITE_ADMIN_PHONES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const email = (session.user.email || '').toLowerCase();
  const phone = session.user.phone || session.user.phone_number || '';
  return (email && adminEmails.includes(email)) || (phone && adminPhones.includes(phone));
}

// Defense-in-depth: the server (functions/admin-api) is the source of truth.
// We hit a tiny endpoint to confirm the session is actually admin before
// rendering admin UI, so we can't be fooled by a stale/forged client check.
async function verifyAdminWithServer(session) {
  try {
    const token = session?.access_token;
    if (!token) return false;
    const base =
      import.meta.env.VITE_GCP_FUNCTION_BASE_URL ||
      import.meta.env.VITE_GCP_FUNCTIONS_URL ||
      import.meta.env.VITE_API_URL;
    if (!base) return false;
    const resp = await fetch(`${base}/admin-api/users?pageSize=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export const AdminProtectedRoute = ({ session, children }) => {
  const location = useLocation();
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setStatus('no-session');
      return;
    }
    if (!isAdminUserClient(session)) {
      setStatus('not-admin');
      return;
    }
    verifyAdminWithServer(session).then((ok) => {
      if (cancelled) return;
      setStatus(ok ? 'admin' : 'not-admin');
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (status === 'no-session') {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (status === 'not-admin') {
    return <Navigate to="/settings" replace />;
  }
  if (status === 'admin') {
    return children;
  }
  return (
    <div className="p-6 flex justify-center items-center h-screen">
      <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500"></div>
      <p className="ml-3 text-lg">Verifying access…</p>
    </div>
  );
};
