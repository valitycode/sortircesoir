-- SortirCeSoir - Schéma Supabase complet
-- À exécuter dans Supabase > SQL Editor > New query

create extension if not exists "pgcrypto";

-- 1) Tables
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  username text not null unique,
  city text not null default '',
  bio text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  type text not null,
  mood text not null,
  budget_category text not null,
  moment text not null,
  companion_type text not null,
  transport text not null,
  distance_label text not null,
  description text not null,
  estimated_price text not null,
  maps_url text,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  outing_id uuid not null references public.outings(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, outing_id)
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(sender_id, receiver_id)
);

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  friend_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, friend_id),
  check (user_id <> friend_id)
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid references public.profiles(id) on delete set null,
  guest_name text,
  outing_id uuid not null references public.outings(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  invite_token text not null unique,
  message text,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid not null references public.profiles(id) on delete cascade,
  user2_id uuid references public.profiles(id) on delete set null,
  guest_name text,
  invitation_id uuid references public.invitations(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  system_message boolean not null default false,
  content text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- 2) Index utiles
create index if not exists idx_profiles_username on public.profiles (lower(username));
create index if not exists idx_outings_city on public.outings (lower(city));
create index if not exists idx_favorites_user on public.favorites(user_id);
create index if not exists idx_inv_sender on public.invitations(sender_id);
create index if not exists idx_inv_receiver on public.invitations(receiver_id);
create index if not exists idx_inv_token on public.invitations(invite_token);
create index if not exists idx_conv_users on public.conversations(user1_id, user2_id);
create index if not exists idx_msg_conv on public.messages(conversation_id, created_at);

-- 3) Updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists friend_requests_set_updated_at on public.friend_requests;
create trigger friend_requests_set_updated_at before update on public.friend_requests
for each row execute function public.set_updated_at();

-- 4) Vue publique de recherche par pseudo
-- security_invoker = true évite le contournement RLS des vues classiques.
create or replace view public.profiles_public
with (security_invoker = true)
as
select id, first_name, username, city, avatar_url
from public.profiles;

-- 5) RLS
alter table public.profiles enable row level security;
alter table public.outings enable row level security;
alter table public.favorites enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.invitations enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Nettoyage pour relancer le script sans conflit
drop policy if exists "profiles_select_relevant" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "outings_read_all" on public.outings;
drop policy if exists "favorites_select_own" on public.favorites;
drop policy if exists "favorites_insert_own" on public.favorites;
drop policy if exists "favorites_delete_own" on public.favorites;
drop policy if exists "friend_requests_select_involved" on public.friend_requests;
drop policy if exists "friend_requests_insert_own" on public.friend_requests;
drop policy if exists "friend_requests_update_receiver" on public.friend_requests;
drop policy if exists "friendships_select_own" on public.friendships;
drop policy if exists "friendships_insert_own" on public.friendships;
drop policy if exists "invitations_select_involved" on public.invitations;
drop policy if exists "invitations_insert_sender" on public.invitations;
drop policy if exists "invitations_update_involved" on public.invitations;
drop policy if exists "conversations_select_member" on public.conversations;
drop policy if exists "conversations_insert_member" on public.conversations;
drop policy if exists "messages_select_member" on public.messages;
drop policy if exists "messages_insert_member" on public.messages;
drop policy if exists "messages_update_read_member" on public.messages;

-- Profils : lecture limitée au profil propre + personnes liées à l'utilisateur.
-- La recherche publique utilise profiles_public, qui ne contient que des champs non sensibles.
create policy "profiles_select_relevant" on public.profiles
for select using (
  id = auth.uid()
  or exists (select 1 from public.friendships f where f.user_id = auth.uid() and f.friend_id = profiles.id)
  or exists (select 1 from public.friend_requests fr where auth.uid() in (fr.sender_id, fr.receiver_id) and profiles.id in (fr.sender_id, fr.receiver_id))
  or exists (select 1 from public.conversations c where auth.uid() in (c.user1_id, c.user2_id) and profiles.id in (c.user1_id, c.user2_id))
);

create policy "profiles_insert_own" on public.profiles
for insert with check (id = auth.uid());

create policy "profiles_update_own" on public.profiles
for update using (id = auth.uid()) with check (id = auth.uid());

-- Sorties : catalogue lisible par tous, écriture réservée au SQL/admin.
create policy "outings_read_all" on public.outings
for select using (true);

-- Favoris
create policy "favorites_select_own" on public.favorites
for select using (user_id = auth.uid());

create policy "favorites_insert_own" on public.favorites
for insert with check (user_id = auth.uid());

create policy "favorites_delete_own" on public.favorites
for delete using (user_id = auth.uid());

-- Demandes d'ami
create policy "friend_requests_select_involved" on public.friend_requests
for select using (auth.uid() in (sender_id, receiver_id));

create policy "friend_requests_insert_own" on public.friend_requests
for insert with check (sender_id = auth.uid() and receiver_id <> auth.uid());

create policy "friend_requests_update_receiver" on public.friend_requests
for update using (receiver_id = auth.uid()) with check (receiver_id = auth.uid());

-- Amitiés : dans l'app, l'acceptation crée deux lignes, une dans chaque sens.
create policy "friendships_select_own" on public.friendships
for select using (user_id = auth.uid());

create policy "friendships_insert_own" on public.friendships
for insert with check (user_id = auth.uid() or friend_id = auth.uid());

-- Invitations : seulement expéditeur ou destinataire connecté.
-- La lecture anonyme par lien passe par la fonction RPC sécurisée get_invitation_by_token().
create policy "invitations_select_involved" on public.invitations
for select using (auth.uid() in (sender_id, receiver_id));

create policy "invitations_insert_sender" on public.invitations
for insert with check (sender_id = auth.uid());

create policy "invitations_update_involved" on public.invitations
for update using (auth.uid() in (sender_id, receiver_id)) with check (auth.uid() in (sender_id, receiver_id));

-- Conversations
create policy "conversations_select_member" on public.conversations
for select using (auth.uid() in (user1_id, user2_id));

create policy "conversations_insert_member" on public.conversations
for insert with check (user1_id = auth.uid() or user2_id = auth.uid());

-- Messages
create policy "messages_select_member" on public.messages
for select using (
  exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
    and auth.uid() in (c.user1_id, c.user2_id)
  )
);

create policy "messages_insert_member" on public.messages
for insert with check (
  exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
    and auth.uid() in (c.user1_id, c.user2_id)
  )
  and (sender_id = auth.uid() or system_message = true)
);

create policy "messages_update_read_member" on public.messages
for update using (
  exists (
    select 1 from public.conversations c
    where c.id = messages.conversation_id
    and auth.uid() in (c.user1_id, c.user2_id)
  )
);

-- 6) Fonctions RPC pour les invitations publiques par token
-- Permet de lire seulement l'invitation dont on connaît le token, sans exposer toute la table.
create or replace function public.get_invitation_by_token(p_token text)
returns table (
  invitation_id uuid,
  status text,
  message text,
  sender_first_name text,
  sender_username text,
  outing_name text,
  outing_city text,
  outing_type text,
  outing_moment text,
  outing_description text
)
language sql
security definer
set search_path = public
as $$
  select
    i.id,
    i.status,
    i.message,
    p.first_name,
    p.username,
    o.name,
    o.city,
    o.type,
    o.moment,
    o.description
  from public.invitations i
  join public.profiles p on p.id = i.sender_id
  join public.outings o on o.id = i.outing_id
  where i.invite_token = p_token
  limit 1;
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

create or replace function public.respond_to_invitation(
  p_token text,
  p_status text,
  p_guest_name text default null,
  p_responder_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invitations%rowtype;
  v_conv_id uuid;
  v_name text;
  v_content text;
  v_auth_id uuid;
begin
  if p_status not in ('accepted','declined') then
    raise exception 'Statut invalide';
  end if;

  v_auth_id := auth.uid();

  select * into v_inv
  from public.invitations
  where invite_token = p_token
  limit 1;

  if not found then
    raise exception 'Invitation introuvable';
  end if;

  -- Identité affichée : profil connecté > prénom invité > guest_name déjà stocké > "Ton ami"
  if v_auth_id is not null then
    select first_name into v_name from public.profiles where id = v_auth_id;
  end if;
  v_name := coalesce(nullif(v_name,''), nullif(p_guest_name,''), nullif(v_inv.guest_name,''), 'Ton ami');

  update public.invitations
  set
    status = p_status,
    receiver_id = coalesce(receiver_id, v_auth_id),
    guest_name = coalesce(nullif(p_guest_name,''), guest_name),
    responded_at = now()
  where id = v_inv.id;

  select id into v_conv_id
  from public.conversations
  where invitation_id = v_inv.id
  order by created_at asc
  limit 1;

  if v_conv_id is null then
    insert into public.conversations(user1_id, user2_id, guest_name, invitation_id)
    values(v_inv.sender_id, coalesce(v_inv.receiver_id, v_auth_id), coalesce(p_guest_name, v_inv.guest_name), v_inv.id)
    returning id into v_conv_id;
  end if;

  if p_status = 'accepted' then
    v_content := v_name || ' est partant pour sortir.';
  else
    v_content := v_name || ' ne peut pas venir.';
  end if;

  insert into public.messages(conversation_id, sender_id, system_message, content)
  values(v_conv_id, null, true, v_content);
end;
$$;

grant execute on function public.respond_to_invitation(text,text,text,uuid) to anon, authenticated;

-- 7) Storage avatars
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_read_public" on storage.objects;
drop policy if exists "avatars_insert_own_folder" on storage.objects;
drop policy if exists "avatars_update_own_folder" on storage.objects;
drop policy if exists "avatars_delete_own_folder" on storage.objects;

create policy "avatars_read_public" on storage.objects
for select using (bucket_id = 'avatars');

create policy "avatars_insert_own_folder" on storage.objects
for insert with check (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "avatars_update_own_folder" on storage.objects
for update using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

create policy "avatars_delete_own_folder" on storage.objects
for delete using (
  bucket_id = 'avatars'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- 8) Données fictives : 30 sorties
insert into public.outings (name, city, type, mood, budget_category, moment, companion_type, transport, distance_label, description, estimated_price, maps_url, image_url) values
('Comedy Club cosy','Paris','spectacle','festif','10–30 €','ce soir','amis','transport','20 min en métro','Une soirée stand-up dans une petite salle chaleureuse avec programmation locale.','18 €','https://www.google.com/maps/search/comedy+club+Paris',null),
('Balade sur les quais','Paris','balade','chill','gratuit','maintenant','couple','à pied','15 min à pied','Promenade douce au bord de l’eau, parfaite pour discuter sans pression.','0 €','https://www.google.com/maps/search/quais+Paris',null),
('Expo nocturne immersive','Paris','culture','culturel','10–30 €','ce soir','amis','transport','25 min en métro','Une exposition lumineuse et sensorielle pour changer de décor.','22 €','https://www.google.com/maps/search/exposition+immersive+Paris',null),
('Rooftop coucher de soleil','Paris','bar','romantique','30 €+','ce soir','couple','transport','30 min en métro','Un verre avec vue pour une ambiance premium et romantique.','35 €','https://www.google.com/maps/search/rooftop+Paris',null),
('Escape game mystère','Paris','jeu','insolite','30 €+','ce week-end','amis','transport','25 min en métro','Une mission immersive pour tester votre esprit d’équipe.','32 €','https://www.google.com/maps/search/escape+game+Paris',null),
('Session basket playground','Paris','sport','sportif','gratuit','maintenant','amis','à pied','10 min à pied','Match improvisé sur un terrain de quartier.','0 €','https://www.google.com/maps/search/playground+basket+Paris',null),
('Cinéma indépendant','Lyon','cinéma','chill','10–30 €','ce soir','seul','transport','18 min en métro','Film d’auteur dans une salle intimiste, idéal en solo.','12 €','https://www.google.com/maps/search/cinema+independant+Lyon',null),
('Bouchon lyonnais entre amis','Lyon','restaurant','festif','30 €+','ce soir','amis','transport','20 min en métro','Cuisine généreuse et ambiance conviviale au centre-ville.','38 €','https://www.google.com/maps/search/bouchon+lyonnais+Lyon',null),
('Parc de la Tête d’Or','Lyon','nature','famille','gratuit','ce week-end','famille','à pied','Selon ton quartier','Grand parc pour marcher, voir les serres et respirer.','0 €','https://www.google.com/maps/search/Parc+de+la+Tete+d%27Or',null),
('Atelier céramique','Lyon','atelier','insolite','30 €+','ce week-end','couple','transport','25 min en métro','Créer un objet à deux dans une ambiance douce et créative.','45 €','https://www.google.com/maps/search/atelier+ceramique+Lyon',null),
('Musée express','Lyon','culture','culturel','moins de 10 €','maintenant','seul','transport','15 min en métro','Une visite courte pour nourrir ta curiosité sans y passer la journée.','8 €','https://www.google.com/maps/search/musee+Lyon',null),
('Run sur les berges','Lyon','sport','sportif','gratuit','maintenant','seul','à pied','5 à 20 min','Un parcours simple au bord du Rhône pour bouger maintenant.','0 €','https://www.google.com/maps/search/berges+du+Rhone+Lyon',null),
('Apéro vieux port','Marseille','bar','festif','10–30 €','ce soir','amis','transport','15 min en bus','Ambiance méditerranéenne et terrasse vivante.','20 €','https://www.google.com/maps/search/bar+vieux+port+Marseille',null),
('Calanque facile','Marseille','nature','sportif','gratuit','ce week-end','amis','voiture','30 min en voiture','Petite randonnée et vue mer, à préparer avec chaussures adaptées.','0 €','https://www.google.com/maps/search/calanques+Marseille',null),
('Glacier en amoureux','Marseille','food','romantique','moins de 10 €','ce soir','couple','à pied','10 min à pied','Une pause sucrée simple, parfaite après une balade.','6 €','https://www.google.com/maps/search/glacier+Marseille',null),
('Street-art au Panier','Marseille','balade','culturel','gratuit','maintenant','amis','à pied','20 min à pied','Explorer ruelles, couleurs et fresques dans un quartier iconique.','0 €','https://www.google.com/maps/search/street+art+panier+Marseille',null),
('Karaoké privé','Marseille','musique','festif','10–30 €','ce soir','amis','transport','25 min en tram','Une salle pour chanter fort sans jugement.','24 €','https://www.google.com/maps/search/karaoke+Marseille',null),
('Paddle découverte','Marseille','sport','insolite','30 €+','ce week-end','amis','voiture','25 min en voiture','Une sortie originale sur l’eau si la météo est bonne.','40 €','https://www.google.com/maps/search/paddle+Marseille',null),
('Café lecture','Bordeaux','café','chill','moins de 10 €','maintenant','seul','à pied','12 min à pied','Un café calme pour lire, écrire ou juste souffler.','5 €','https://www.google.com/maps/search/cafe+lecture+Bordeaux',null),
('Dégustation sans alcool','Bordeaux','atelier','insolite','10–30 €','ce soir','amis','transport','20 min en tram','Découverte de boissons locales et mocktails travaillés.','18 €','https://www.google.com/maps/search/mocktail+Bordeaux',null),
('Miroir d’eau by night','Bordeaux','balade','romantique','gratuit','ce soir','couple','à pied','15 min à pied','Un classique simple et très photogénique.','0 €','https://www.google.com/maps/search/miroir+d%27eau+Bordeaux',null),
('Marché gourmand','Bordeaux','food','famille','10–30 €','ce week-end','famille','transport','20 min en tram','Stands variés pour que chacun trouve son bonheur.','15 €','https://www.google.com/maps/search/marche+gourmand+Bordeaux',null),
('Concert intimiste','Bordeaux','musique','culturel','10–30 €','ce soir','amis','transport','25 min en tram','Petite salle, découverte d’artistes et ambiance proche de la scène.','20 €','https://www.google.com/maps/search/concert+Bordeaux',null),
('Vélo urbain','Bordeaux','sport','sportif','moins de 10 €','maintenant','amis','à pied','Station proche','Tour léger en vélo partagé pour changer d’air.','4 €','https://www.google.com/maps/search/velo+Bordeaux',null),
('Brunch créatif','Nantes','restaurant','chill','10–30 €','ce week-end','amis','transport','18 min en tram','Brunch cosy avec déco soignée et bons produits.','26 €','https://www.google.com/maps/search/brunch+Nantes',null),
('Machines de l’île','Nantes','culture','insolite','10–30 €','ce week-end','famille','transport','20 min en tram','Une sortie spectaculaire et originale pour tous les âges.','12 €','https://www.google.com/maps/search/machines+de+l%27ile+Nantes',null),
('Bar à jeux','Nantes','jeu','festif','moins de 10 €','ce soir','amis','transport','15 min en tram','Des jeux de société et une ambiance détendue pour rire vite.','7 €','https://www.google.com/maps/search/bar+a+jeux+Nantes',null),
('Jardin japonais','Nantes','nature','romantique','gratuit','maintenant','couple','à pied','15 min à pied','Une balade paisible dans un décor dépaysant.','0 €','https://www.google.com/maps/search/jardin+japonais+Nantes',null),
('Piscine détente','Nantes','sport','sportif','moins de 10 €','maintenant','seul','transport','20 min en bus','Quelques longueurs pour déconnecter sans gros budget.','5 €','https://www.google.com/maps/search/piscine+Nantes',null),
('Quiz night','Nantes','bar','festif','10–30 €','ce soir','amis','transport','18 min en tram','Un quiz d’équipe pour une soirée sociale et compétitive.','12 €','https://www.google.com/maps/search/quiz+night+Nantes',null)
on conflict do nothing;
