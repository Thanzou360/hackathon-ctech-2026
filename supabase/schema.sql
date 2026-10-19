-- =====================================================================
-- Hackathon C-Tech 2026 — base de données Supabase
-- À exécuter une seule fois dans Supabase : SQL Editor > New query > Run.
-- Le script peut être relancé sans perte de données (idempotent).
--
-- Principe de sécurité : le site n'a AUCUN accès direct aux tables.
-- Il passe uniquement par les fonctions ci-dessous (RPC), qui valident
-- les données côté serveur. La clé « anon » du site peut donc être publique.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.hk_settings (
  id                  int primary key default 1 check (id = 1),
  admin_password_hash text,
  opens_at            timestamptz not null default '2026-10-19 00:00:00+01',
  closes_at           timestamptz not null default '2026-11-07 00:00:00+01', -- fin du 6 novembre (heure du Gabon)
  max_teams           int not null default 20,
  team_size           int not null default 5
);
insert into public.hk_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.hk_teams (
  id                 int primary key,
  name               text not null,
  -- collecting : en cours de constitution
  -- awaiting_team_info : complète, le chef doit finaliser
  -- submitted : le chef a envoyé le dossier, l'organisation doit valider
  -- confirmed : validée par l'organisation
  status             text not null default 'collecting'
                     check (status in ('collecting', 'awaiting_team_info', 'submitted', 'confirmed')),
  fil                text not null default '',
  tel                text not null default '',
  idea               text not null default '',
  invite_token_hash  text unique,
  invite_expires_at  timestamptz,
  invite_used_at     timestamptz,
  submitted_at       timestamptz,
  confirmed_at       timestamptz,
  created_at         timestamptz not null default now()
);
insert into public.hk_teams (id, name)
  select g, 'Équipe ' || lpad(g::text, 2, '0') from generate_series(1, 20) g
  on conflict (id) do nothing;

create table if not exists public.hk_participants (
  id         bigint generated always as identity primary key,
  team_id    int not null references public.hk_teams(id),
  name       text not null,
  fil        text not null,
  mail       text not null,
  tel        text not null,
  is_leader  boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists hk_participants_mail_uq on public.hk_participants (lower(mail));
create index if not exists hk_participants_team_idx on public.hk_participants (team_id);

create table if not exists public.hk_jury (
  id           bigint generated always as identity primary key,
  name         text not null,
  organization text not null,
  mail         text not null,
  tel          text not null default '',
  expertise    text not null default '',
  days         text[] not null default '{}',
  created_at   timestamptz not null default now()
);
create unique index if not exists hk_jury_mail_uq on public.hk_jury (lower(mail));

create table if not exists public.hk_admin_attempts (
  id  bigint generated always as identity primary key,
  at  timestamptz not null default now(),
  ok  boolean not null
);

-- Aucun accès direct : RLS activé sans aucune règle + droits retirés.
alter table public.hk_settings       enable row level security;
alter table public.hk_teams          enable row level security;
alter table public.hk_participants   enable row level security;
alter table public.hk_jury           enable row level security;
alter table public.hk_admin_attempts enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.hk_settings, public.hk_teams, public.hk_participants, public.hk_jury, public.hk_admin_attempts from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.hk_settings, public.hk_teams, public.hk_participants, public.hk_jury, public.hk_admin_attempts from authenticated;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Outils internes
-- ---------------------------------------------------------------------
create or replace function public.hk_clean(p_value text, p_field text, p_max int, p_required boolean default true)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := btrim(coalesce(p_value, ''));
begin
  if p_required and v = '' then
    raise exception 'Le champ « % » est obligatoire.', p_field;
  end if;
  if char_length(v) > p_max then
    raise exception 'Le champ « % » dépasse la longueur autorisée.', p_field;
  end if;
  return v;
end $$;

create or replace function public.hk_clean_mail(p_value text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := lower(public.hk_clean(p_value, 'e-mail', 254));
begin
  if v !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Saisis une adresse e-mail valide.';
  end if;
  return v;
end $$;

create or replace function public.hk_clean_tel(p_value text, p_required boolean default true)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := public.hk_clean(p_value, 'téléphone', 32, p_required);
declare d text;
begin
  if v = '' then return ''; end if;
  d := regexp_replace(v, '[[:space:]().-]', '', 'g');
  if d !~ '^(\+?241|00241)?0?[0-9]{8}$' then
    raise exception 'Saisis un numéro gabonais valide (8 ou 9 chiffres, avec ou sans indicatif +241).';
  end if;
  return d;
end $$;

-- Vérifie le mot de passe administrateur (limite : 10 échecs / 15 min).
-- Ne lève pas d'exception pour que la tentative échouée soit bien enregistrée.
create or replace function public.hk_admin_ok(p_password text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare h text;
begin
  select admin_password_hash into h from hk_settings where id = 1;
  if h is null then return 'Le mot de passe administrateur n’est pas encore configuré.'; end if;
  if (select count(*) from hk_admin_attempts where not ok and at > now() - interval '15 minutes') >= 10 then
    return 'Trop de tentatives. Réessaie dans 15 minutes.';
  end if;
  if p_password is null or extensions.crypt(p_password, h) <> h then
    insert into hk_admin_attempts (ok) values (false);
    return 'Mot de passe administrateur invalide.';
  end if;
  return null;  -- accès autorisé
end $$;

-- ---------------------------------------------------------------------
-- Fonctions publiques (appelées par le site)
-- ---------------------------------------------------------------------

-- Préinscription individuelle + répartition aléatoire dans l'équipe la moins remplie.
create or replace function public.hk_preinscrire(p_name text, p_fil text, p_mail text, p_tel text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s hk_settings;
  v_name text := public.hk_clean(p_name, 'nom complet', 100);
  v_fil  text := public.hk_clean(p_fil, 'filière', 100);
  v_mail text := public.hk_clean_mail(p_mail);
  v_tel  text := public.hk_clean_tel(p_tel);
  v_team int; v_count int; v_leader boolean;
begin
  select * into s from hk_settings where id = 1;
  if now() < s.opens_at then raise exception 'Les préinscriptions ne sont pas encore ouvertes.'; end if;
  if now() >= s.closes_at then raise exception 'Les préinscriptions sont closes.'; end if;
  if char_length(v_name) < 3 then raise exception 'Saisis ton nom complet.'; end if;

  -- Une seule répartition à la fois : évite que deux candidats prennent la même place.
  perform pg_advisory_xact_lock(20261113);

  if exists (select 1 from hk_participants where lower(mail) = v_mail) then
    raise exception 'Cette adresse e-mail a déjà été utilisée pour une préinscription.';
  end if;

  select t.id, coalesce(c.n, 0) into v_team, v_count
  from hk_teams t
  left join (select team_id, count(*) n from hk_participants group by team_id) c on c.team_id = t.id
  where t.status = 'collecting' and t.id <= s.max_teams and coalesce(c.n, 0) < s.team_size
  order by coalesce(c.n, 0), random()
  limit 1;

  if v_team is null then
    raise exception 'Les % équipes sont complètes. Les préinscriptions sont closes.', s.max_teams;
  end if;

  v_leader := (v_count = 0);
  insert into hk_participants (team_id, name, fil, mail, tel, is_leader)
  values (v_team, v_name, v_fil, v_mail, v_tel, v_leader);
  v_count := v_count + 1;

  if v_count >= s.team_size then
    update hk_teams set status = 'awaiting_team_info' where id = v_team;
  end if;

  return jsonb_build_object(
    'ok', true,
    'assignment', jsonb_build_object(
      'name', (select name from hk_teams where id = v_team),
      'memberCount', v_count,
      'teamSize', s.team_size,
      'isLeader', v_leader,
      'teamComplete', v_count >= s.team_size));
end $$;

-- Lecture d'une invitation (lien personnel envoyé au chef par l'organisation).
create or replace function public.hk_invitation(p_token text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t hk_teams; l hk_participants;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{48}$' then raise exception 'Ce lien d’invitation est invalide.'; end if;
  select * into t from hk_teams
   where invite_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then raise exception 'Ce lien d’invitation est invalide ou a été remplacé.'; end if;
  if t.status in ('submitted', 'confirmed') or t.invite_used_at is not null then
    raise exception 'Cette équipe a déjà envoyé son dossier.';
  end if;
  if t.invite_expires_at < now() then raise exception 'Ce lien d’invitation a expiré. Demande un nouveau lien à l’organisation.'; end if;
  select * into l from hk_participants where team_id = t.id and is_leader limit 1;
  return jsonb_build_object(
    'assignedTeam', t.name, 'name', l.name, 'mail', l.mail, 'tel', l.tel, 'fil', l.fil,
    'members', coalesce((select jsonb_agg(jsonb_build_object('name', p.name) order by p.created_at)
                          from hk_participants p where p.team_id = t.id and not p.is_leader), '[]'::jsonb));
end $$;

-- Envoi du dossier d'équipe par le chef.
create or replace function public.hk_finaliser(p_token text, p_fil text, p_tel text, p_idee text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare t hk_teams;
  v_fil text := public.hk_clean(p_fil, 'filière principale', 100);
  v_tel text := public.hk_clean_tel(p_tel);
  v_idee text := public.hk_clean(p_idee, 'idée de projet', 2000, false);
begin
  perform public.hk_invitation(p_token);  -- mêmes contrôles (validité, expiration, usage unique)
  update hk_teams
     set status = 'submitted', fil = v_fil, tel = v_tel, idea = v_idee,
         submitted_at = now(), invite_used_at = now()
   where invite_token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  returning * into t;
  return jsonb_build_object('ok', true, 'team', jsonb_build_object('name', t.name),
    'message', 'Le dossier de l’équipe a été transmis. L’organisation va le vérifier avant de valider votre inscription.');
end $$;

-- Candidature au jury.
create or replace function public.hk_jury_candidature(p_name text, p_org text, p_mail text, p_tel text, p_exp text, p_days text[])
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mail text := public.hk_clean_mail(p_mail);
begin
  if exists (select 1 from hk_jury where lower(mail) = v_mail) then
    raise exception 'Cette adresse e-mail a déjà été utilisée pour une candidature.';
  end if;
  insert into hk_jury (name, organization, mail, tel, expertise, days)
  values (public.hk_clean(p_name, 'nom complet', 100), public.hk_clean(p_org, 'organisation et fonction', 160), v_mail,
          public.hk_clean_tel(p_tel, false), public.hk_clean(p_exp, 'domaine d’expertise', 200, false),
          (select coalesce(array_agg(d), '{}') from unnest(coalesce(p_days, '{}')) d
            where d in ('Jour 1 (vendredi)', 'Jour 2 (samedi)', 'Jour 3 (dimanche)')));
  return jsonb_build_object('ok', true, 'message', 'Votre candidature a bien été transmise à l’organisation.');
end $$;

-- ---------------------------------------------------------------------
-- Fonctions de l'espace organisateur (protégées par mot de passe)
-- ---------------------------------------------------------------------
create or replace function public.hk_admin_data(p_password text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare err text := public.hk_admin_ok(p_password);
begin
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  return jsonb_build_object('ok', true,
    'settings', (select jsonb_build_object('opens_at', opens_at, 'closes_at', closes_at, 'max_teams', max_teams, 'team_size', team_size) from hk_settings where id = 1),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'status', t.status, 'fil', t.fil, 'tel', t.tel, 'idea', t.idea,
        'submitted_at', t.submitted_at, 'confirmed_at', t.confirmed_at, 'invite_expires_at', t.invite_expires_at,
        'member_count', (select count(*) from hk_participants p where p.team_id = t.id),
        'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'fil', p.fil, 'mail', p.mail, 'tel', p.tel,
                    'is_leader', p.is_leader, 'created_at', p.created_at) order by p.created_at)
                    from hk_participants p where p.team_id = t.id), '[]'::jsonb)) order by t.id)
      from hk_teams t), '[]'::jsonb),
    'jury', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'name', j.name, 'organization', j.organization, 'mail', j.mail,
        'tel', j.tel, 'expertise', j.expertise, 'days', to_jsonb(j.days), 'created_at', j.created_at) order by j.created_at desc)
      from hk_jury j), '[]'::jsonb));
end $$;

-- Génère (ou régénère) le lien personnel du chef d'une équipe complète.
-- Le lien précédent devient invalide. Valable 7 jours.
create or replace function public.hk_admin_invitation(p_password text, p_team_id int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare err text := public.hk_admin_ok(p_password); t hk_teams; tok text; l hk_participants;
begin
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  select * into t from hk_teams where id = p_team_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Équipe introuvable.'); end if;
  if t.status <> 'awaiting_team_info' then
    return jsonb_build_object('ok', false, 'error', 'Un lien ne peut être créé que pour une équipe complète en attente de finalisation.');
  end if;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  update hk_teams set invite_token_hash = encode(extensions.digest(tok, 'sha256'), 'hex'),
                      invite_expires_at = now() + interval '7 days', invite_used_at = null
   where id = p_team_id;
  select * into l from hk_participants where team_id = p_team_id and is_leader limit 1;
  return jsonb_build_object('ok', true, 'token', tok, 'expires_at', now() + interval '7 days',
    'team', t.name, 'leader', jsonb_build_object('name', l.name, 'mail', l.mail, 'tel', l.tel));
end $$;

-- Validation (ou retour en finalisation) d'un dossier d'équipe.
create or replace function public.hk_admin_set_status(p_password text, p_team_id int, p_status text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare err text := public.hk_admin_ok(p_password); cur text;
begin
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  select status into cur from hk_teams where id = p_team_id;
  if cur is null then return jsonb_build_object('ok', false, 'error', 'Équipe introuvable.'); end if;
  if p_status = 'confirmed' and cur = 'submitted' then
    update hk_teams set status = 'confirmed', confirmed_at = now() where id = p_team_id;
  elsif p_status = 'awaiting_team_info' and cur in ('submitted', 'confirmed') then
    update hk_teams set status = 'awaiting_team_info', confirmed_at = null, invite_used_at = null,
                        invite_token_hash = null, invite_expires_at = null where id = p_team_id;
  else
    return jsonb_build_object('ok', false, 'error', 'Changement de statut non autorisé.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Suppression d'un participant (doublon, test, désistement).
-- Si c'était le chef, le membre inscrit juste après devient chef.
-- Une équipe complète redevient « en constitution » et son lien d'invitation est annulé.
create or replace function public.hk_admin_delete_participant(p_password text, p_participant_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare err text := public.hk_admin_ok(p_password); p hk_participants; st text; new_chef text;
begin
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  perform pg_advisory_xact_lock(20261113);
  select * into p from hk_participants where id = p_participant_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'Participant introuvable (déjà supprimé ?).'); end if;
  select status into st from hk_teams where id = p.team_id;
  if st in ('submitted', 'confirmed') then
    return jsonb_build_object('ok', false, 'error', 'Cette équipe a déjà envoyé son dossier : clique d’abord sur « Renvoyer en finalisation » ou « Annuler la validation ».');
  end if;
  delete from hk_participants where id = p.id;
  if p.is_leader then
    update hk_participants set is_leader = true
     where id = (select id from hk_participants where team_id = p.team_id order by created_at, id limit 1)
    returning name into new_chef;
  end if;
  update hk_teams set status = 'collecting', invite_token_hash = null, invite_expires_at = null, invite_used_at = null
   where id = p.team_id and status = 'awaiting_team_info';
  return jsonb_build_object('ok', true, 'deleted', p.name, 'newLeader', new_chef);
end $$;

create or replace function public.hk_admin_delete_jury(p_password text, p_jury_id bigint)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare err text := public.hk_admin_ok(p_password); n text;
begin
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  delete from hk_jury where id = p_jury_id returning name into n;
  if n is null then return jsonb_build_object('ok', false, 'error', 'Candidature introuvable.'); end if;
  return jsonb_build_object('ok', true, 'deleted', n);
end $$;

-- À lancer UNE fois dans le SQL Editor (jamais depuis le site) :
--   select public.hk_set_admin_password('un-mot-de-passe-long-et-secret');
create or replace function public.hk_set_admin_password(p_new text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if char_length(coalesce(p_new, '')) < 12 then raise exception 'Choisis un mot de passe d’au moins 12 caractères.'; end if;
  update hk_settings set admin_password_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)) where id = 1;
  return 'Mot de passe administrateur enregistré.';
end $$;

-- ---------------------------------------------------------------------
-- Droits d'exécution
-- ---------------------------------------------------------------------
revoke all on function public.hk_clean(text, text, int, boolean), public.hk_clean_mail(text), public.hk_clean_tel(text, boolean),
  public.hk_admin_ok(text), public.hk_set_admin_password(text),
  public.hk_preinscrire(text, text, text, text), public.hk_invitation(text), public.hk_finaliser(text, text, text, text),
  public.hk_jury_candidature(text, text, text, text, text, text[]), public.hk_admin_data(text),
  public.hk_admin_invitation(text, int), public.hk_admin_set_status(text, int, text),
  public.hk_admin_delete_participant(text, bigint), public.hk_admin_delete_jury(text, bigint) from public;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('grant execute on function public.hk_preinscrire(text, text, text, text), public.hk_invitation(text),
        public.hk_finaliser(text, text, text, text), public.hk_jury_candidature(text, text, text, text, text, text[]),
        public.hk_admin_data(text), public.hk_admin_invitation(text, int), public.hk_admin_set_status(text, int, text),
        public.hk_admin_delete_participant(text, bigint), public.hk_admin_delete_jury(text, bigint) to %I', r);
    end if;
  end loop;
end $$;
