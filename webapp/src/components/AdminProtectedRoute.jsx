import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';

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

export const AdminProtectedRoute = ({ session, children }) => {
  const location = useLocation();
  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }
  if (!isAdminUser(session)) {
    return <Navigate to="/settings" replace />;
  }
  return children;
};




