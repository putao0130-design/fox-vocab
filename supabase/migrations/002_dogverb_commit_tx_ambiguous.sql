-- Fix dogverb_commit_tx: PostgreSQL 42702 ambiguous column "coll".
-- The function in 001 used plpgsql variables named coll (and compared them to
-- public.dogverb_kv.coll). A challenge write then raised 42702 and the Edge
-- Function returned {"error":"server-error","code":"42702"}.
--
-- Where to run: Supabase Dashboard → project zkvscutsjspzuteogfet →
-- SQL Editor → New query. Paste this whole file and click Run.
-- Do not re-run 001_dogverb_sync.sql. Do not turn on a paid plan.
-- This file contains no passwords, no service_role key, and no JWT.
-- It does not grant anything to anon or authenticated.

CREATE OR REPLACE FUNCTION public.dogverb_commit_tx(p_reads jsonb, p_writes jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_key text;
  v_coll text;
  v_id text;
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
    FOREACH v_key IN ARRAY keys LOOP
      IF position(E'\n' IN v_key) = 0 THEN
        RAISE EXCEPTION 'bad-key';
      END IF;
      v_coll := split_part(v_key, E'\n', 1);
      v_id := substr(v_key, length(v_coll) + 2);
      IF NOT (v_coll = ANY (allowed)) THEN
        RAISE EXCEPTION 'bad-collection';
      END IF;
      PERFORM 1
        FROM public.dogverb_kv AS kv
        WHERE kv.coll = v_coll
          AND kv.id = v_id
        FOR UPDATE;
    END LOOP;
  END IF;

  FOR v_key, expected IN
    SELECT key, value FROM jsonb_each(COALESCE(p_reads, '{}'::jsonb))
  LOOP
    v_coll := split_part(v_key, E'\n', 1);
    v_id := substr(v_key, length(v_coll) + 2);
    IF NOT (v_coll = ANY (allowed)) THEN
      RAISE EXCEPTION 'bad-collection';
    END IF;
    SELECT kv.doc INTO actual
      FROM public.dogverb_kv AS kv
      WHERE kv.coll = v_coll
        AND kv.id = v_id;
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

  FOR v_key, write IN
    SELECT key, value FROM jsonb_each(COALESCE(p_writes, '{}'::jsonb))
  LOOP
    v_coll := write->>'coll';
    v_id := write->>'id';
    IF v_coll IS NULL OR v_id IS NULL THEN
      v_coll := split_part(v_key, E'\n', 1);
      v_id := substr(v_key, length(v_coll) + 2);
    END IF;
    IF NOT (v_coll = ANY (allowed)) THEN
      RAISE EXCEPTION 'bad-collection';
    END IF;
    IF write->>'op' = 'remove' THEN
      DELETE FROM public.dogverb_kv AS kv
        WHERE kv.coll = v_coll
          AND kv.id = v_id;
    ELSIF write->>'op' = 'put' THEN
      INSERT INTO public.dogverb_kv (coll, id, doc)
      VALUES (v_coll, v_id, COALESCE(write->'doc', '{}'::jsonb))
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

NOTIFY pgrst, 'reload schema';
