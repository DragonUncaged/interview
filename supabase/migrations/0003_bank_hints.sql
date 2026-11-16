-- ============================================================================
-- PARALLEL · bank hints stay on the server
--
-- Any signed-in, non-anonymous account could read pl_problems.hints, so a
-- candidate who joined with a real account could read a bank problem's hints
-- without revealing them. Bank hints are now copied on the server only:
-- /api/sessions reads them with the service role, and pl_assign_problem() runs
-- as its owner. No client reads the column.
-- ============================================================================

revoke select (hints) on public.pl_problems from authenticated;
