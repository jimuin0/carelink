-- Enable RLS on all CareLink tables
-- Policy: anon can INSERT only, cannot READ/UPDATE/DELETE

-- salons
ALTER TABLE salons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous insert" ON salons FOR INSERT TO anon WITH CHECK (true);

-- job_seekers
ALTER TABLE job_seekers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous insert" ON job_seekers FOR INSERT TO anon WITH CHECK (true);

-- contacts
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous insert" ON contacts FOR INSERT TO anon WITH CHECK (true);
