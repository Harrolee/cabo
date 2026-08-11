import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { supabase } from '../../main';
import {
  CREATOR_SLUG_RULE,
  CREATOR_SOCIAL_PLATFORMS,
  createCreatorProfile,
  isCreatorSlugAvailable,
  slugifyCreatorName,
  updateCreatorProfile,
  validateCreatorForm,
  validateCreatorSlug,
} from '../../utils/creators';
import { useCreatorProfile } from '../../hooks/useCreatorProfile';
import CreatorStatusBanner from './CreatorStatusBanner';

const EMPTY_FORM = {
  display_name: '',
  slug: '',
  bio: '',
  avatar_url: '',
  website_url: '',
  social_links: {},
};

function formFromProfile(profile) {
  if (!profile) return { ...EMPTY_FORM };
  return {
    display_name: profile.display_name || '',
    slug: profile.slug || '',
    bio: profile.bio || '',
    avatar_url: profile.avatar_url || '',
    website_url: profile.website_url || '',
    social_links: profile.social_links || {},
  };
}

const Field = ({ label, hint, error, children }) => (
  <div className="space-y-1">
    <label className="block text-sm font-medium text-gray-700">{label}</label>
    {children}
    {error ? (
      <p className="text-sm text-red-600">{error}</p>
    ) : hint ? (
      <p className="text-xs text-gray-500">{hint}</p>
    ) : null}
  </div>
);

const inputClass = (hasError) =>
  `w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${
    hasError ? 'border-red-400' : 'border-gray-300'
  }`;

const CreatorProfilePage = () => {
  const { creator, setCreator, loading } = useCreatorProfile();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugTaken, setSlugTaken] = useState(false);
  const [coaches, setCoaches] = useState([]);

  const isNew = !creator;

  useEffect(() => {
    if (creator) {
      setForm(formFromProfile(creator));
      setSlugTouched(true);
    }
  }, [creator]);

  useEffect(() => {
    if (!creator) return;
    let cancelled = false;
    supabase
      .from('coach_profiles')
      .select('id, name, handle, listing_status, active')
      .eq('creator_id', creator.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => { if (!cancelled) setCoaches(data || []); });
    return () => { cancelled = true; };
  }, [creator]);

  // Handle availability is checked against a SECURITY DEFINER function, because
  // RLS hides pending creators' rows and would report a taken handle as free.
  const slug = form.slug;
  useEffect(() => {
    if (!slug || validateCreatorSlug(slug)) { setSlugTaken(false); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const available = await isCreatorSlugAvailable(slug);
      if (!cancelled) setSlugTaken(!available);
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [slug]);

  const update = (field, value) => {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // Suggest a handle while the creator has not chosen one themselves.
      if (field === 'display_name' && !slugTouched) {
        next.slug = slugifyCreatorName(value);
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const updateSocial = (key, value) => {
    setForm((prev) => ({ ...prev, social_links: { ...(prev.social_links || {}), [key]: value } }));
  };

  const slugError = useMemo(() => {
    if (errors.slug) return errors.slug;
    if (slugTaken) return `The handle "${form.slug}" is already taken. Try another.`;
    return null;
  }, [errors.slug, slugTaken, form.slug]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextErrors = validateCreatorForm(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    if (slugTaken) return;

    setSaving(true);
    try {
      const saved = isNew
        ? await createCreatorProfile(form)
        : await updateCreatorProfile(creator.id, form);
      setCreator(saved);
      toast.success(isNew ? 'Creator profile created — we will review it shortly.' : 'Creator profile updated.');
    } catch (error) {
      console.error('Failed to save creator profile:', error);
      const message = error.message || 'Failed to save creator profile.';
      if (/handle/i.test(message)) setErrors((prev) => ({ ...prev, slug: message }));
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          {isNew ? 'Become a creator' : 'Creator profile'}
        </h1>
        <p className="text-gray-600 mt-2">
          {isNew
            ? 'Creators publish coaches on the platform and get paid for them. Tell us who you are and we will review your account.'
            : 'This is the profile audiences see next to every coach you publish.'}
        </p>
      </div>

      <CreatorStatusBanner status={creator?.status || 'none'} />

      <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
        <Field label="Display name" error={errors.display_name} hint="The name shown on your coaches.">
          <input
            className={inputClass(errors.display_name)}
            value={form.display_name}
            onChange={(e) => update('display_name', e.target.value)}
            placeholder="Ada Rivers"
            maxLength={80}
          />
        </Field>

        <Field label="Handle" error={slugError} hint={CREATOR_SLUG_RULE}>
          <div className="flex items-center">
            <span className="px-3 py-2 border border-r-0 border-gray-300 rounded-l-lg bg-gray-50 text-gray-500 text-sm">
              /creators/
            </span>
            <input
              className={`${inputClass(!!slugError)} rounded-l-none`}
              value={form.slug}
              onChange={(e) => { setSlugTouched(true); update('slug', e.target.value.toLowerCase()); }}
              placeholder="ada-rivers"
              maxLength={40}
            />
          </div>
        </Field>

        <Field label="Bio" hint="A couple of sentences on what you teach and who you teach it to.">
          <textarea
            className={inputClass(false)}
            rows={4}
            value={form.bio}
            onChange={(e) => update('bio', e.target.value)}
            placeholder="I have taught drum kit for fifteen years…"
            maxLength={1000}
          />
        </Field>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Field label="Avatar URL" error={errors.avatar_url} hint="A square image works best.">
            <input
              className={inputClass(errors.avatar_url)}
              value={form.avatar_url}
              onChange={(e) => update('avatar_url', e.target.value)}
              placeholder="https://…"
            />
          </Field>
          <Field label="Website" error={errors.website_url}>
            <input
              className={inputClass(errors.website_url)}
              value={form.website_url}
              onChange={(e) => update('website_url', e.target.value)}
              placeholder="https://…"
            />
          </Field>
        </div>

        <div className="space-y-2">
          <h2 className="text-sm font-medium text-gray-700">Social links</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {CREATOR_SOCIAL_PLATFORMS.map((platform) => (
              <div key={platform.key} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-sm text-gray-500">{platform.label}</span>
                <input
                  className={inputClass(false)}
                  value={form.social_links?.[platform.key] || ''}
                  onChange={(e) => updateSocial(platform.key, e.target.value)}
                  placeholder={platform.placeholder}
                />
              </div>
            ))}
          </div>
        </div>

        {form.avatar_url && (
          <div className="flex items-center gap-3 pt-2">
            <img
              src={form.avatar_url}
              alt=""
              className="w-12 h-12 rounded-full object-cover border border-gray-200"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <span className="text-sm text-gray-500">Avatar preview</span>
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : isNew ? 'Create creator profile' : 'Save changes'}
          </button>
          {!isNew && (
            <Link to="/my-coaches" className="text-sm text-gray-600 hover:text-gray-900">
              My coaches →
            </Link>
          )}
        </div>
      </form>

      {creator && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 space-y-3">
          <h2 className="font-semibold text-gray-900">Platform terms</h2>
          <p className="text-sm text-gray-600">
            These are set by the platform, not by you. Nothing this form submits can change them.
          </p>
          <div className="grid grid-cols-2 gap-y-2 text-sm max-w-sm">
            <span className="text-gray-500">Approval status</span>
            <span className="font-medium capitalize">{creator.status}</span>
            <span className="text-gray-500">Your revenue share</span>
            <span className="font-medium">{(creator.revenue_share_bps / 100).toFixed(0)}%</span>
            <span className="text-gray-500">Payouts</span>
            <span className="font-medium">{creator.payout_provider || 'Not set up yet'}</span>
          </div>
        </div>
      )}

      {creator && coaches.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
          <h2 className="font-semibold text-gray-900">Coaches credited to you</h2>
          <ul className="divide-y">
            {coaches.map((coach) => (
              <li key={coach.id} className="py-2 flex items-center justify-between text-sm">
                <span>
                  {coach.name} <span className="text-gray-500">@{coach.handle}</span>
                </span>
                <span className="text-gray-500 capitalize">{(coach.listing_status || 'draft').replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
          <Link to="/my-coaches" className="text-sm text-blue-600 hover:underline">
            Publish and manage them →
          </Link>
        </div>
      )}
    </div>
  );
};

export default CreatorProfilePage;
