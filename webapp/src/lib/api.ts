import { supabase } from './supabase';
import type { CreateUserProfile } from './types';

export async function createUserProfile(profile: CreateUserProfile) {
  const { data, error } = await supabase
    .from('user_profiles')
    .insert([profile])
    .select()
    .single();

  if (error) throw error;
  return data;
}