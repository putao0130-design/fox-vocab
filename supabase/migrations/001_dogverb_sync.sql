-- Dog Verb pairing and sync, for the existing Free project zkvscutsjspzuteogfet.
-- Do not run this against any other project. Do not turn on a paid plan.
--
-- Where to run: Supabase Dashboard → SQL Editor → New query. Paste this whole
-- file and click Run. Do not deploy or merge the pull request in order to apply
-- this. GitHub stays unconnected.
--
-- Leave Data API automatic grants OFF
-- (Project Settings → Data API, or Project Settings → API): do not auto-grant
-- new tables to anon or authenticated. This script still revokes those grants
-- and enables Row Level Security with no policies, so a direct Data API call
-- with the anon/publishable key cannot read or write anyone's rows.
--
-- This file contains no passwords, no service_role key, and no JWT.

CREATE TABLE IF NOT EXISTS public.dogverb_kv (
  coll text NOT NULL,
  id text NOT NULL,
  doc jsonb NOT NULL,
  PRIMARY KEY (coll, id),
  CONSTRAINT dogverb_kv_coll_allowed
    CHECK (coll IN ('spaces', 'devices', 'pairing', 'sessions', 'nonces', 'rate'))
);

CREATE INDEX IF NOT EXISTS dogverb_kv_pairing_code
  ON public.dogverb_kv ((doc->>'codeHash'))
  WHERE coll = 'pairing';

CREATE INDEX IF NOT EXISTS dogverb_kv_space_recovery
  ON public.dogverb_kv ((doc->>'recoveryHash'))
  WHERE coll = 'spaces';

CREATE INDEX IF NOT EXISTS dogverb_kv_device_space
  ON public.dogverb_kv ((doc->>'spaceId'))
  WHERE coll = 'devices';

CREATE INDEX IF NOT EXISTS dogverb_kv_session_device
  ON public.dogverb_kv ((doc->>'deviceId'))
  WHERE coll = 'sessions';

CREATE INDEX IF NOT EXISTS dogverb_kv_pairing_space
  ON public.dogverb_kv ((doc->>'spaceId'))
  WHERE coll = 'pairing';

ALTER TABLE public.dogverb_kv ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dogverb_kv FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.dogverb_kv FROM PUBLIC;
REVOKE ALL ON TABLE public.dogverb_kv FROM anon;
REVOKE ALL ON TABLE public.dogverb_kv FROM authenticated;
GRANT ALL ON TABLE public.dogverb_kv TO service_role;

-- Atomic commit for the Edge Function's document adapter.
-- EXECUTE is granted only to service_role. anon and authenticated cannot call it.
CREATE OR REPLACE FUNCTION public.dogverb_commit_tx(p_reads jsonb, p_writes jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  coll text;
  rec_id text;
  expected jsonb;
  actual jsonb;
  write jsonb;
  keys text[];
  allowed text[] := ARRAY['spaces', 'devices', 'pairing', 'sessions', 'nonces', 'rate'];
BEGIN
  keys := ARRAY(
    SELECT x FROM (
      SELECT jsonb_object_keys(COALESCE(p_reads, '{}'::jsonb)) AS x
      UNION
      SELECT jsonb_object_keys(COALESCE(p_writes, '{}'::jsonb)) AS x
    ) s
    ORDER BY x
  );

  IF keys IS NOT NULL THEN
    FOREACH k IN ARRAY keys LOOP
      IF position(E'\n' IN k) = 0 THEN
        RAISE EXCEPTION 'bad-key';
      END IF;
      coll := split_part(k, E'\n', 1);
      rec_id := substr(k, length(coll) + 2);
      IF NOT (coll = ANY (allowed)) THEN
        RAISE EXCEPTION 'bad-collection';
      END IF;
      PERFORM 1
        FROM public.dogverb_kv
        WHERE public.dogverb_kv.coll = coll
          AND public.dogverb_kv.id = rec_id
        FOR UPDATE;
    END LOOP;
  END IF;

  FOR k, expected IN
    SELECT key, value FROM jsonb_each(COALESCE(p_reads, '{}'::jsonb))
  LOOP
    coll := split_part(k, E'\n', 1);
    rec_id := substr(k, length(coll) + 2);
    IF NOT (coll = ANY (allowed)) THEN
      RAISE EXCEPTION 'bad-collection';
    END IF;
    SELECT doc INTO actual
      FROM public.dogverb_kv
      WHERE public.dogverb_kv.coll = coll
        AND public.dogverb_kv.id = rec_id;
    IF expected IS NULL OR expected = 'null'::jsonb THEN
      IF actual IS NOT NULL THEN
        RETURN false;
      END IF;
    ELSE
      IF actual IS NULL OR actual IS DISTINCT FROM expected THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;

  FOR k, write IN
    SELECT key, value FROM jsonb_each(COALESCE(p_writes, '{}'::jsonb))
  LOOP
    coll := write->>'coll';
    rec_id := write->>'id';
    IF coll IS NULL OR rec_id IS NULL THEN
      coll := split_part(k, E'\n', 1);
      rec_id := substr(k, length(coll) + 2);
    END IF;
    IF NOT (coll = ANY (allowed)) THEN
      RAISE EXCEPTION 'bad-collection';
    END IF;
    IF write->>'op' = 'remove' THEN
      DELETE FROM public.dogverb_kv
        WHERE public.dogverb_kv.coll = coll
          AND public.dogverb_kv.id = rec_id;
    ELSIF write->>'op' = 'put' THEN
      INSERT INTO public.dogverb_kv (coll, id, doc)
      VALUES (coll, rec_id, COALESCE(write->'doc', '{}'::jsonb))
      ON CONFLICT (coll, id) DO UPDATE SET doc = EXCLUDED.doc;
    ELSE
      RAISE EXCEPTION 'bad-op';
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.dogverb_commit_tx(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dogverb_commit_tx(jsonb, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.dogverb_commit_tx(jsonb, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dogverb_commit_tx(jsonb, jsonb) TO service_role;
