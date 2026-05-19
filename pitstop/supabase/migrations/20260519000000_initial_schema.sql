-- Pitstop initial schema: users, teams, change_requests, approvals, audit_log
-- Run via Supabase CLI: supabase db push (or paste in SQL editor)

-- Roles enum
CREATE TYPE public.user_role AS ENUM ('manager', 'wfm_analyst', 'wfm_admin');

CREATE TYPE public.change_request_status AS ENUM (
  'pending',
  'approved',
  'denied',
  'review'
);

CREATE TYPE public.capacity_decision AS ENUM ('approve', 'deny', 'review');

-- Teams (manager owns a team of reps)
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  manager_id UUID NOT NULL,
  assembled_site_id TEXT,
  queue_ids TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User profiles (extends auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role public.user_role NOT NULL DEFAULT 'manager',
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  assembled_person_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_team_id_idx ON public.users(team_id);
CREATE INDEX users_email_idx ON public.users(email);

-- Change requests (schedule edits, meetings, etc.)
CREATE TABLE public.change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  team_id UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  rep_assembled_id TEXT,
  rep_name TEXT,
  change_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status public.change_request_status NOT NULL DEFAULT 'pending',
  capacity_decision public.capacity_decision,
  capacity_reasoning TEXT,
  alternatives JSONB,
  assembled_activity_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX change_requests_requester_idx ON public.change_requests(requester_id);
CREATE INDEX change_requests_status_idx ON public.change_requests(status);

-- Approvals (WFM review queue)
CREATE TABLE public.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id UUID NOT NULL REFERENCES public.change_requests(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  decision public.capacity_decision NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX approvals_change_request_idx ON public.approvals(change_request_id);

-- Audit log (append-only)
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_actor_idx ON public.audit_log(actor_id);
CREATE INDEX audit_log_created_idx ON public.audit_log(created_at DESC);

-- Auto-create profile on signup (domain check happens in app + RLS)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at helper
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER change_requests_updated_at BEFORE UPDATE ON public.change_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row Level Security ──

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Helper: current user's role
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_wfm()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT role IN ('wfm_analyst', 'wfm_admin') FROM public.users WHERE id = auth.uid()),
    false
  );
$$;

-- users: read self; WFM reads all; managers read teammates on same team
CREATE POLICY users_select_self ON public.users
  FOR SELECT USING (
    id = auth.uid()
    OR public.is_wfm()
    OR team_id = (SELECT team_id FROM public.users WHERE id = auth.uid())
  );

CREATE POLICY users_update_self ON public.users
  FOR UPDATE USING (id = auth.uid());

-- teams: manager sees own team; WFM sees all
CREATE POLICY teams_select ON public.teams
  FOR SELECT USING (
    manager_id = auth.uid()
    OR public.is_wfm()
    OR id = (SELECT team_id FROM public.users WHERE id = auth.uid())
  );

-- change_requests: requester + team manager + WFM
CREATE POLICY change_requests_select ON public.change_requests
  FOR SELECT USING (
    requester_id = auth.uid()
    OR public.is_wfm()
    OR team_id = (SELECT team_id FROM public.users WHERE id = auth.uid())
    OR team_id IN (SELECT id FROM public.teams WHERE manager_id = auth.uid())
  );

CREATE POLICY change_requests_insert ON public.change_requests
  FOR INSERT WITH CHECK (requester_id = auth.uid());

-- approvals: WFM only for write; read if linked to visible request
CREATE POLICY approvals_select ON public.approvals
  FOR SELECT USING (
    public.is_wfm()
    OR EXISTS (
      SELECT 1 FROM public.change_requests cr
      WHERE cr.id = change_request_id
        AND (cr.requester_id = auth.uid() OR cr.team_id IN (
          SELECT id FROM public.teams WHERE manager_id = auth.uid()
        ))
    )
  );

CREATE POLICY approvals_insert_wfm ON public.approvals
  FOR INSERT WITH CHECK (public.is_wfm());

-- audit_log: managers see own actions; WFM sees all
CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT USING (
    actor_id = auth.uid()
    OR public.is_wfm()
  );

-- Service role bypasses RLS (used by Netlify functions for audit writes)
