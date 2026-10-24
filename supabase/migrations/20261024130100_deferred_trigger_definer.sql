-- Deferred invariant checks must not depend on which Postgres version fires them.
--
-- The constraint triggers on participation, open_responses, closed_tallies and
-- votes are DEFERRED: they fire at COMMIT, after the SECURITY DEFINER routine
-- that queued them has returned. PostgreSQL 18 runs such triggers as the role
-- that queued the event (the routine owner); PostgreSQL 17 (Supabase today)
-- runs them as the role current at commit, i.e. the signed-in caller, who is
-- rightly not allowed to execute app_private routines. Making the trigger
-- functions SECURITY DEFINER gives the same safe, owner-privileged behaviour
-- on both. search_path is already fixed to the empty path on both functions.

set local role cp_owner;

alter function app_private.check_vote_invariants() security definer;
alter function app_private.check_vote_invariants_on_vote() security definer;

reset role;
