import React from 'react';
import { Link } from 'react-router-dom';

/**
 * States approval honestly. A pending creator is not blocked from building —
 * they are blocked from the roster, and the banner says exactly that.
 */
export const CREATOR_STATUS_COPY = {
  none: {
    tone: 'bg-blue-50 border-blue-200 text-blue-900',
    icon: '✨',
    title: 'You are not a creator yet',
    body: 'Creator profiles are what let a coach be published to the roster. Setting one up takes a minute.',
  },
  pending: {
    tone: 'bg-yellow-50 border-yellow-200 text-yellow-900',
    icon: '⏳',
    title: 'Your creator account is under review',
    body: 'You can build, preview and chat with your coaches right now. Publishing to the public roster unlocks once we approve you — we will list anything you have submitted as soon as that happens.',
  },
  approved: {
    tone: 'bg-green-50 border-green-200 text-green-900',
    icon: '✅',
    title: 'Approved creator',
    body: 'You can publish your coaches to the public roster.',
  },
  suspended: {
    tone: 'bg-red-50 border-red-200 text-red-900',
    icon: '⛔',
    title: 'Your creator account is suspended',
    body: 'Your coaches are hidden from the roster and cannot be published. Get in touch and we will take another look.',
  },
};

export const CreatorStatusBanner = ({ status, showLink = false, className = '' }) => {
  const copy = CREATOR_STATUS_COPY[status] || CREATOR_STATUS_COPY.none;

  return (
    <div className={`border rounded-lg p-4 ${copy.tone} ${className}`}>
      <div className="flex items-start gap-3">
        <div className="text-xl leading-none" aria-hidden="true">{copy.icon}</div>
        <div className="flex-1">
          <h3 className="font-semibold">{copy.title}</h3>
          <p className="text-sm mt-1 opacity-90">{copy.body}</p>
          {showLink && (
            <Link to="/creator" className="inline-block mt-2 text-sm font-medium underline">
              {status && status !== 'none' ? 'Manage creator profile →' : 'Set up your creator profile →'}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default CreatorStatusBanner;
