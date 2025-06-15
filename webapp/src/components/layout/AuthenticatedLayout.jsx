import React from 'react';
import { Link, Outlet } from 'react-router-dom';
import { supabase } from '../../main';

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