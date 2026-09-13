/*
# R3A Booth — Core Database Schema

1. Purpose
   Creates the cloud database tables for the R3A Booth photobooth app.
   This is a single-tenant app with no sign-in screen, so all data is
   shared/public and accessible via the anon key.

2. New Tables

   - `events`
     Stores photobooth events (parties, weddings, corporate events, etc.).
     - `id` (text, primary key) — client-generated unique ID (e.g. "evt-1234-abcd")
     - `event_name` (text) — display name of the event
     - `client_name` (text) — name of the client/host
     - `date` (text) — event date as ISO string
     - `location` (text) — venue or address
     - `frames` (jsonb) — array of frame layouts, each with slots for photo placement
     - `output_settings` (jsonb) — destination folder, file naming pattern, save flags
     - `printer_settings` (jsonb) — printer name, paper size, copies
     - `event_status` (text) — one of 'Ready', 'Active', 'Ended'
     - `created_at` (timestamptz) — row creation time
     - `updated_at` (timestamptz) — last modification time

   - `guests`
     Stores per-event guest records, one per guest session.
     - `id` (text, primary key) — client-generated unique ID
     - `event_id` (text, foreign key → events.id ON DELETE CASCADE)
     - `guest_number` (integer) — sequential number within the event (1, 2, 3…)
     - `guest_name` (text) — display name like "Guest 1"
     - `guest_folder_id` (text) — Google Drive folder ID for this guest
     - `main_folder_id` (text) — parent Google Drive folder ID
     - `created_at` (timestamptz) — row creation time

   - `upload_records`
     Tracks which files have been uploaded to Google Drive to prevent duplicates.
     - `id` (text, primary key) — client-generated unique ID
     - `guest_folder_id` (text) — Google Drive folder ID (indexed)
     - `file_name` (text) — name of the uploaded file (e.g. "final.jpg", "slot-01.jpg")
     - `file_id` (text) — Google Drive file ID returned after upload
     - `uploaded_at` (timestamptz) — when the upload completed
     - Unique constraint on (guest_folder_id, file_name) to prevent duplicate records

3. Security
   - RLS enabled on all tables.
   - Policies use `TO anon, authenticated` with `USING (true)` / `WITH CHECK (true)`
     because this is a single-tenant app with no sign-in screen — all data is
     intentionally shared and the frontend operates with the anon key.
   - 4 separate policies per table (SELECT, INSERT, UPDATE, DELETE).

4. Indexes
   - `guests_event_id_idx` — fast lookup of guests by event
   - `guests_guest_folder_id_idx` — fast duplicate-prevention check by folder ID
   - `upload_records_guest_folder_id_idx` — fast lookup of uploads by folder
   - `upload_records_guest_folder_file_idx` — unique constraint on folder + file name
*/

-- --- events table -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS events (
  id text PRIMARY KEY,
  event_name text NOT NULL DEFAULT '',
  client_name text NOT NULL DEFAULT '',
  date text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  frames jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  printer_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  event_status text NOT NULL DEFAULT 'Ready',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_events" ON events;
CREATE POLICY "anon_select_events" ON events FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_events" ON events;
CREATE POLICY "anon_insert_events" ON events FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_events" ON events;
CREATE POLICY "anon_update_events" ON events FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_events" ON events;
CREATE POLICY "anon_delete_events" ON events FOR DELETE
  TO anon, authenticated USING (true);

-- --- guests table -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS guests (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  guest_number integer NOT NULL DEFAULT 1,
  guest_name text NOT NULL DEFAULT '',
  guest_folder_id text NOT NULL DEFAULT '',
  main_folder_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE guests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_guests" ON guests;
CREATE POLICY "anon_select_guests" ON guests FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_guests" ON guests;
CREATE POLICY "anon_insert_guests" ON guests FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_guests" ON guests;
CREATE POLICY "anon_update_guests" ON guests FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_guests" ON guests;
CREATE POLICY "anon_delete_guests" ON guests FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS guests_event_id_idx ON guests(event_id);
CREATE INDEX IF NOT EXISTS guests_guest_folder_id_idx ON guests(guest_folder_id);

-- --- upload_records table ---------------------------------------------------

CREATE TABLE IF NOT EXISTS upload_records (
  id text PRIMARY KEY,
  guest_folder_id text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  file_id text NOT NULL DEFAULT '',
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE upload_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_upload_records" ON upload_records;
CREATE POLICY "anon_select_upload_records" ON upload_records FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_upload_records" ON upload_records;
CREATE POLICY "anon_insert_upload_records" ON upload_records FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_upload_records" ON upload_records;
CREATE POLICY "anon_update_upload_records" ON upload_records FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_upload_records" ON upload_records;
CREATE POLICY "anon_delete_upload_records" ON upload_records FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS upload_records_guest_folder_id_idx ON upload_records(guest_folder_id);
CREATE UNIQUE INDEX IF NOT EXISTS upload_records_guest_folder_file_idx
  ON upload_records(guest_folder_id, file_name);