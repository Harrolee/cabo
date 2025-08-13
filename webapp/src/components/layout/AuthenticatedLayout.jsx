import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { supabase } from '../../main';

function isAdminUser(session) {
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

export const AuthenticatedLayout = ({ session }) => {
  return (
    <div>
      <nav className="bg-gray-800 text-white p-4">
        <ul className="flex space-x-4 items-center">
          <li><Link to="/">Home (Main App)</Link></li>
          <li><Link to="/coach-builder">Coach Builder</Link></li>
          <li><Link to="/my-coaches">My Coaches</Link></li>
          <li><Link to="/settings">Settings</Link></li>
          <li><Link to="/billing">Billing</Link></li>
          <li><Link to="/coaches">Coaches</Link></li>
          {isAdminUser(session) && <li><Link to="/admin">Admin</Link></li>}
          <li className="ml-auto">Logged in as: {session.user.email || session.user.phone}</li>
          <li>
            <button 
              onClick={() => supabase.auth.signOut()} 
              className="bg-red-500 hover:bg-red-700 text-white font-bold py-1 px-3 rounded text-sm"
            >
              Sign Out
            </button>
          </li>
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}; 