import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CategoryFilter } from '@/components/CategoryFilter';
import { CoachCard } from '@/components/CoachCard';
import { EmptyState, ErrorState, Loading, Screen } from '@/components/Screen';
import { fetchCategories, fetchRoster } from '@/lib/api';
import { theme } from '@/lib/theme';
import type { CoachCategory, RosterCoach } from '@/lib/types';

const PAGE_SIZE = 20;

export default function RosterScreen() {
  const router = useRouter();

  const [categories, setCategories] = useState<CoachCategory[]>([]);
  const [category, setCategory] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [coaches, setCoaches] = useState<RosterCoach[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against an older in-flight query overwriting a newer one when the
  // user types quickly or flips categories mid-request.
  const requestId = useRef(0);

  useEffect(() => {
    fetchCategories()
      .then(setCategories)
      .catch((err) => console.warn('Could not load categories:', err.message));
  }, []);

  // Debounce the search box so every keystroke is not a round trip.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'more') => {
      const id = ++requestId.current;
      const offset = mode === 'more' ? coaches.length : 0;

      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      if (mode === 'more') setLoadingMore(true);

      try {
        const page = await fetchRoster({ category, search, limit: PAGE_SIZE, offset });
        if (id !== requestId.current) return;

        setCoaches((prev) => (mode === 'more' ? [...prev, ...page] : page));
        setExhausted(page.length < PAGE_SIZE);
        setError(null);
      } catch (err: any) {
        if (id !== requestId.current) return;
        setError(err?.message ?? 'Could not load the roster');
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    },
    [category, search, coaches.length]
  );

  useEffect(() => {
    void load('initial');
    // `load` closes over coaches.length, which would re-trigger on every page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, search]);

  const header = useMemo(
    () => (
      <View style={styles.header}>
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.search}
            placeholder="Search coaches, disciplines, skills"
            placeholderTextColor={theme.color.textFaint}
            value={searchInput}
            onChangeText={setSearchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
        {/* Bleed the chips to the screen edges through the list's own padding. */}
        <View style={styles.chipBleed}>
          <CategoryFilter categories={categories} selected={category} onSelect={setCategory} />
        </View>
      </View>
    ),
    [categories, category, searchInput]
  );

  return (
    <Screen edges={[]}>
      <FlatList
        data={coaches}
        keyExtractor={(coach) => coach.id}
        ListHeaderComponent={header}
        stickyHeaderIndices={[0]}
        contentContainerStyle={styles.list}
        keyboardDismissMode="on-drag"
        renderItem={({ item }) => (
          <CoachCard coach={item} onPress={() => router.push(`/coach/${item.id}`)} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => load('refresh')}
            tintColor={theme.color.textMuted}
          />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (!loading && !loadingMore && !exhausted && coaches.length > 0) {
            void load('more');
          }
        }}
        ListEmptyComponent={
          loading ? (
            <Loading />
          ) : error ? (
            <ErrorState message={error} onRetry={() => load('initial')} />
          ) : (
            <EmptyState
              title="No coaches yet"
              body={
                search || category
                  ? 'Nothing matches that. Try a different search or category.'
                  : 'The roster is empty. Check back soon.'
              }
            />
          )
        }
        ListFooterComponent={
          loadingMore ? <Text style={styles.footer}>Loading more…</Text> : null
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: theme.space(5),
    paddingBottom: theme.space(10),
    flexGrow: 1,
  },
  header: {
    // Opaque so list content does not show through the sticky header.
    backgroundColor: theme.color.bg,
  },
  chipBleed: {
    marginHorizontal: -theme.space(5),
  },
  searchWrap: {
    paddingTop: theme.space(2),
  },
  search: {
    backgroundColor: theme.color.surface,
    borderWidth: 1,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    color: theme.color.text,
    fontSize: theme.font.body,
    // Explicit: iOS reuses native TextInput views and does not clear
    // letterSpacing when the prop is absent, so a previously-rendered
    // spaced field (the sign-in code box) bleeds into this one.
    letterSpacing: 0,
  },
  footer: {
    color: theme.color.textFaint,
    fontSize: theme.font.small,
    textAlign: 'center',
    paddingVertical: theme.space(4),
  },
});
