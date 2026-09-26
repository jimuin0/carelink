-- Enforce the invariant at the row write, not just the UI's earlier read.
-- Deployment prerequisite: count existing published rows violating this exact
-- predicate, resolve them without invented addresses, then VALIDATE CONSTRAINT.
-- NOT VALID does NOT exempt subsequent updates to existing rows. Until that
-- preflight is clean, production application is blocked; this does not backfill.
BEGIN;
ALTER TABLE public.facility_profiles
  ADD CONSTRAINT published_facility_location_present CHECK (
    status IS DISTINCT FROM 'published' OR (
      -- ECMAScript String.trim whitespace, shared with the application gate.
      length(btrim(coalesce(prefecture, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0
      AND length(btrim(coalesce(city, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0
      AND length(btrim(coalesce(address, ''), U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) > 0
    )
  ) NOT VALID;
COMMIT;
