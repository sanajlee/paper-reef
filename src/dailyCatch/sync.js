import { supabase } from '../supabase';

const TABLE = 'paper_reef_daily_catches';

export async function loadCatches(userId, today) {
  const { data, error } = await supabase.from(TABLE)
    .select('catch_date,assignment,revision')
    .eq('user_id', userId).lte('catch_date', today)
    .order('catch_date', { ascending: false }).limit(16);
  if (error) throw error;
  return data ?? [];
}

// The (user_id, catch_date) primary key ensures the same daily selection
// even when two devices open Paper Reef simultaneously.
export async function createCatch(userId, selection) {
  const { error } = await supabase.from(TABLE).insert({
    user_id: userId, catch_date: selection.date, assignment: selection,
  });
  if (error && error.code !== '23505') throw error;
  const { data, error: readError } = await supabase.from(TABLE)
    .select('catch_date,assignment,revision')
    .eq('user_id', userId).eq('catch_date', selection.date).single();
  if (readError) throw readError;
  return data;
}

// Optimistic locking prevents concurrent rerolls from silently overwriting one another.
export async function updateCatch(userId, date, assignment, revision) {
  const { data, error } = await supabase.from(TABLE)
    .update({ assignment, revision: revision + 1, updated_at: new Date().toISOString() })
    .eq('user_id', userId).eq('catch_date', date).eq('revision', revision)
    .select('catch_date,assignment,revision').maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: latest, error: reloadError } = await supabase.from(TABLE)
    .select('catch_date,assignment,revision')
    .eq('user_id', userId).eq('catch_date', date).single();
  if (reloadError) throw reloadError;
  return latest;
}
