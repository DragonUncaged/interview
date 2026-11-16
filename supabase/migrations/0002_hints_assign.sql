-- ============================================================================
-- PARALLEL · server-enforced hint ladder + atomic problem assignment
--
-- 1. pl_sessions.hints was readable by every participant, so a candidate could
--    read all hints without a reveal being recorded. The column is now revoked
--    from clients; hints are read through pl_session_hints() (interviewers get
--    every hint, candidates only revealed ones) and unlocked one at a time
--    through pl_reveal_hint(), which enforces the ladder and records the reveal.
-- 2. Assigning a bank problem used to be update + delete + insert from the API,
--    so a failed insert left the session with no tests. pl_assign_problem() does
--    it in one transaction, and also clears hint reveals from the old problem.
--
-- Clients must select explicit pl_sessions columns from now on: select('*')
-- fails once table-level SELECT is gone.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1a. column-level lockdown of pl_sessions.hints
-- ---------------------------------------------------------------------------
revoke select on public.pl_sessions from authenticated;
revoke select on public.pl_sessions from anon;

grant select
  (id, created_by, room_key, status, candidate_name, candidate_role_label, problem_id, problem_number,
   problem_title, difficulty, description, follow_up, tags, language, code, starter_code,
   started_at, ended_at, created_at)
  on public.pl_sessions to authenticated;

-- Reveals now only happen through pl_reveal_hint, which enforces the ladder.
drop policy if exists "pl_hints_insert" on public.pl_hint_reveals;

-- ---------------------------------------------------------------------------
-- 1b. read hints: [{ index, revealed, text }] where text is null until revealed
--     (interviewers always get the text)
-- ---------------------------------------------------------------------------
create or replace function public.pl_session_hints(p_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_hints jsonb;
  v_interviewer boolean;
begin
  if not public.pl_is_participant(p_session_id) then
    raise exception 'not_a_participant';
  end if;
  v_interviewer := public.pl_is_interviewer(p_session_id);
  select coalesce(hints, '[]'::jsonb) into v_hints from public.pl_sessions where id = p_session_id;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'index', h.ord - 1,
        'revealed', r.hint_index is not null,
        'text', case when v_interviewer or r.hint_index is not null then h.value #>> '{}' end
      ) order by h.ord)
    from jsonb_array_elements(v_hints) with ordinality as h(value, ord)
    left join public.pl_hint_reveals r
      on r.session_id = p_session_id and r.hint_index = h.ord - 1
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1c. reveal one hint (candidate only, in order), returns its text
-- ---------------------------------------------------------------------------
create or replace function public.pl_reveal_hint(p_session_id uuid, p_index int)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_status text;
  v_hints jsonb;
begin
  if not exists (
    select 1 from public.pl_session_participants
    where session_id = p_session_id and user_id = auth.uid() and role = 'candidate'
  ) then
    raise exception 'not_the_candidate';
  end if;

  select status, coalesce(hints, '[]'::jsonb) into v_status, v_hints
  from public.pl_sessions where id = p_session_id;

  if v_status = 'completed' then
    raise exception 'session_completed';
  end if;
  if p_index is null or p_index < 0 or p_index >= jsonb_array_length(v_hints) then
    raise exception 'no_such_hint';
  end if;
  if p_index > 0 and not exists (
    select 1 from public.pl_hint_reveals where session_id = p_session_id and hint_index = p_index - 1
  ) then
    raise exception 'hint_locked';
  end if;

  insert into public.pl_hint_reveals (session_id, hint_index, revealed_by)
  values (p_session_id, p_index, auth.uid())
  on conflict do nothing;

  return v_hints ->> p_index;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. assign a bank problem atomically (interviewer only; builtin or own problem)
-- ---------------------------------------------------------------------------
create or replace function public.pl_assign_problem(p_session_id uuid, p_problem_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_problem public.pl_problems%rowtype;
  v_visible_count int;
begin
  if not public.pl_is_interviewer(p_session_id) then
    raise exception 'forbidden';
  end if;

  select * into v_problem from public.pl_problems where id = p_problem_id;
  if not found then
    raise exception 'problem_not_found';
  end if;
  -- Never copy another user's private hidden tests into this session.
  if v_problem.owner_id is not null and v_problem.owner_id <> auth.uid() then
    raise exception 'forbidden';
  end if;

  update public.pl_sessions
  set problem_id = v_problem.id,
      problem_number = v_problem.number,
      problem_title = v_problem.title,
      difficulty = v_problem.difficulty,
      description = v_problem.description,
      follow_up = v_problem.follow_up,
      tags = v_problem.tags,
      hints = v_problem.hints,
      starter_code = v_problem.starter_code,
      code = '{}'::jsonb
  where id = p_session_id and status <> 'completed';
  if not found then
    raise exception 'session_completed';
  end if;

  delete from public.pl_test_cases where session_id = p_session_id;
  delete from public.pl_hint_reveals where session_id = p_session_id;

  insert into public.pl_test_cases (session_id, position, hidden, input, expected)
  select p_session_id, t.ord, false, coalesce(t.value ->> 'input', ''), coalesce(t.value ->> 'expected', '')
  from jsonb_array_elements(coalesce(v_problem.visible_tests, '[]'::jsonb)) with ordinality as t(value, ord)
  where t.ord <= 12;
  get diagnostics v_visible_count = row_count;

  insert into public.pl_test_cases (session_id, position, hidden, input, expected)
  select p_session_id, v_visible_count + t.ord, true, coalesce(t.value ->> 'input', ''), coalesce(t.value ->> 'expected', '')
  from jsonb_array_elements(coalesce(v_problem.hidden_tests, '[]'::jsonb)) with ordinality as t(value, ord)
  where t.ord <= 12;
end;
$$;

-- ---------------------------------------------------------------------------
-- grants: signed-in users only
-- ---------------------------------------------------------------------------
revoke all on function public.pl_session_hints(uuid) from public, anon;
revoke all on function public.pl_reveal_hint(uuid, int) from public, anon;
revoke all on function public.pl_assign_problem(uuid, uuid) from public, anon;
grant execute on function public.pl_session_hints(uuid) to authenticated, service_role;
grant execute on function public.pl_reveal_hint(uuid, int) to authenticated, service_role;
grant execute on function public.pl_assign_problem(uuid, uuid) to authenticated, service_role;
