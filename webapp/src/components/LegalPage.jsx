import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';

/**
 * Chrome for the standalone /terms and /privacy pages.
 *
 * These are opened from inside the iOS app (Settings -> Legal) and by App
 * Review, so they render on their own — no session, no video background, no
 * app shell — and stay readable on a phone.
 */
export function LegalPage({ children }) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-8 py-4 flex items-center justify-between">
          <Link to="/" className="font-semibold text-gray-900">
            Cabo Coaches
          </Link>
          <nav className="text-sm space-x-4">
            <Link to="/terms" className="text-blue-600 hover:underline">
              Terms
            </Link>
            <Link to="/privacy" className="text-blue-600 hover:underline">
              Privacy
            </Link>
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
