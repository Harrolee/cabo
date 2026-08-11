import { useCallback, useEffect, useState } from 'react';
import { fetchMyCreatorProfile } from '../utils/creators';

/**
 * The signed-in user's creator profile, or null when they have not made one.
 * `creator.status` is pending | approved | suspended and is set by the
 * platform — never by this client.
 */
export function useCreatorProfile() {
  const [creator, setCreator] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const profile = await fetchMyCreatorProfile();
      setCreator(profile);
      return profile;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchMyCreatorProfile()
      .then((profile) => { if (!cancelled) setCreator(profile); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { creator, setCreator, loading, reload };
}

export default useCreatorProfile;
