-- Complete the earlier additive location guard after a clean data preflight.
-- Validation scans existing rows but never repairs, publishes or deletes them.
-- The official migration transaction rolls back on any concurrent violation.
ALTER TABLE public.facility_profiles
  VALIDATE CONSTRAINT published_facility_location_present;
