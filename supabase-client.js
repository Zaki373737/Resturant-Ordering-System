const SUPABASE_URL = 'https://vkegxkthycrtgsznjaci.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZrZWd4a3RoeWNydGdzem5qYWNpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxNjcwMjAsImV4cCI6MjA5ODc0MzAyMH0.ZyRFhZssveKCgc8kJBZTloOM85YNL0x7nokLZxbh81M';

if (!window.supabaseClient) {
  window.supabaseClient = window.supabase
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
    : null;
}
