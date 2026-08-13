import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { supabase } from '../../main';

/**
 * The club owner's view of whether the thing is working.
 *
 * Everything here is an activity signal. There is no code path in this
 * component that can render a message body, because the functions it calls do
 * not return one — see supabase/migrations/20260812140000_club_engagement.sql
 * and the assertion in mobile/e2e/club-probe.mjs.
 *
 * The dormant list leads, because it is the only part an owner can act on.
 */

const STATE_STYLE = {
  active:  { label: 'Active',        cls: 'bg-green-100 text-green-800' },
  slowing: { label: 'Slowing down',  cls: 'bg-yellow-100 text-yellow-800' },
  dormant: { label: 'Gone quiet',    cls: 'bg-red-100 text-red-800' },
  never:   { label: 'Never started', cls: 'bg-gray-200 text-gray-700' },
};

function Stat({ label, value, hint, tone = 'default' }) {
  const toneCls = tone === 'warn' ? 'text-red-600' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold ${toneCls}`}>{value ?? '—'}</div>
      {hint && <div className="mt-1 text-xs text-gray-500">{hint}</div>}
    </div>
  );
}

/**
 * The promise we make to members, stated where the owner can see it. Members
 * are told the same thing, so this has to stay true to what the SQL does.
 */
function PrivacyNotice() {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <div className="font-semibold">What you can and cannot see</div>
      <p className="mt-1">
        You can see <strong>whether</strong> your members are engaging — when they last
        spoke to their coach, how often, and who has gone quiet.
      </p>
      <p className="mt-1">
        You cannot see <strong>what</strong> they said. Conversations between a member and
        their coach are private, including from you. No message, quote, extract or summary
        of a member&apos;s conversation is available on this page or anywhere else in your
        account. Members are told this too — it is what makes them honest with their coach.
      </p>
    </div>
  );
}

function Sparkline({ series }) {
  const points = useMemo(() => {
    if (!series?.length) return '';
    const max = Math.max(1, ...series.map((d) => Number(d.messages)));
    return series
      .map((d, i) => {
        const x = (i / Math.max(1, series.length - 1)) * 100;
        const y = 30 - (Number(d.messages) / max) * 28;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [series]);

  if (!series?.length) return null;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-16 w-full" role="img"
         aria-label="Member messages per day over the last 30 days">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1"
                className="text-indigo-500" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function ClubDashboard() {
  const [clubs, setClubs] = useState([]);
  const [clubId, setClubId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [activity, setActivity] = useState([]);
  const [series, setSeries] = useState([]);
  const [loading, setLoading] = useState(true);

  // Clubs where this account is an owner or head coach. RLS lets a member read
  // their own club_members row, so this needs no privileged endpoint.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      const uid = session?.session?.user?.id;
      if (!uid) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('club_members')
        .select('club_id, role, clubs ( id, name, slug )')
        .eq('user_id', uid)
        .in('role', ['owner', 'coach'])
        .eq('status', 'active');

      if (!mounted) return;
      if (error) { toast.error(`Could not load your clubs: ${error.message}`); setLoading(false); return; }

      const list = (data ?? []).map((r) => r.clubs).filter(Boolean);
      setClubs(list);
      setClubId((prev) => prev ?? list[0]?.id ?? null);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!clubId) return;
    let mounted = true;
    setLoading(true);
    (async () => {
      const [sum, act, ts] = await Promise.all([
        supabase.rpc('club_engagement_summary', { p_club_id: clubId }),
        supabase.rpc('club_member_activity', { p_club_id: clubId }),
        supabase.rpc('club_engagement_timeseries', { p_club_id: clubId, p_days: 30 }),
      ]);
      if (!mounted) return;

      // A permission failure and an empty club are not the same thing, and
      // must not read the same way. See docs/grant-matrix.md.
      const err = sum.error || act.error || ts.error;
      if (err) toast.error(`Could not load engagement: ${err.message}`);

      setSummary(Array.isArray(sum.data) ? sum.data[0] : sum.data);
      setActivity(act.data ?? []);
      setSeries(ts.data ?? []);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [clubId]);

  const needsAttention = activity.filter((m) => m.state === 'dormant' || m.state === 'never');

  if (loading && !summary) {
    return <div className="p-6 text-gray-500">Loading…</div>;
  }

  if (!clubs.length) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold text-gray-900">Club dashboard</h1>
        <p className="mt-2 text-gray-600">
          This account does not run a club. If you expected to see one here, ask whoever set
          the club up to add you as an owner.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Club dashboard</h1>
          <p className="text-sm text-gray-600">Who is engaging, and who has gone quiet.</p>
        </div>
        {clubs.length > 1 && (
          <select
            value={clubId ?? ''}
            onChange={(e) => setClubId(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </header>

      <PrivacyNotice />

      {/* The actionable list first. A count of dormant members is a number; a
          list of who they are is something a coach can do something about. */}
      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">
          Needs a nudge{needsAttention.length ? ` (${needsAttention.length})` : ''}
        </h2>
        {needsAttention.length === 0 ? (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
            Everyone has spoken to their coach in the last two weeks.
          </div>
        ) : (
          <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
            {needsAttention.map((m) => (
              <li key={m.member_id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {m.display_name || 'Member'}
                  </div>
                  <div className="text-xs text-gray-500">
                    {m.state === 'never'
                      ? 'Has never messaged their coach'
                      : `Last spoke ${m.days_since_active} days ago`}
                  </div>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATE_STYLE[m.state].cls}`}>
                  {STATE_STYLE[m.state].label}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Members" value={summary?.members_total} />
        <Stat label="Active this week" value={summary?.active_this_week} />
        <Stat label="Gone quiet (14d+)" value={summary?.dormant_14d}
              tone={Number(summary?.dormant_14d) > 0 ? 'warn' : 'default'} />
        <Stat label="Never started" value={summary?.never_messaged}
              tone={Number(summary?.never_messaged) > 0 ? 'warn' : 'default'} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-gray-500">
            Member messages, last 30 days
          </div>
          <Sparkline series={series} />
        </div>
        <Stat
          label="Nudge response rate"
          value={summary?.nudge_response_rate == null ? '—' : `${summary.nudge_response_rate}%`}
          hint={
            summary?.nudges_sent_30d
              ? `${summary.nudges_replied_30d} of ${summary.nudges_sent_30d} nudges got a reply within 48 hours`
              : 'No nudges sent in the last 30 days'
          }
        />
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold text-gray-900">Everyone</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Member', 'Status', 'Last active', 'Messages (30d)'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {activity.map((m) => (
                <tr key={m.member_id}>
                  <td className="px-3 py-2 text-sm text-gray-900">{m.display_name || 'Member'}</td>
                  <td className="px-3 py-2 text-sm">
                    <span className={`rounded-full px-2 py-1 text-xs font-medium ${STATE_STYLE[m.state].cls}`}>
                      {STATE_STYLE[m.state].label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700">
                    {m.last_active_at ? `${m.days_since_active}d ago` : '—'}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700">{m.messages_30d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
