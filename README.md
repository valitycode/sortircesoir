# SortirCeSoir

MVP mobile-first en HTML, CSS, JavaScript vanilla + Supabase.

## Fichiers

- `index.html` : frontend complet, styles inclus, JavaScript inclus.
- `manifest.webmanifest` : configuration PWA.
- `sw.js` : service worker simple.
- `supabase-schema.sql` : tables PostgreSQL, RLS, fonctions RPC, bucket avatars et 30 sorties fictives.

## Configuration rapide

1. Crée un projet sur Supabase.
2. Va dans **SQL Editor** et exécute tout `supabase-schema.sql`.
3. Va dans **Project Settings > API**.
4. Copie :
   - `Project URL`
   - `anon public key`
5. Dans `index.html`, remplace :

```js
const SUPABASE_URL = "https://TON-PROJET.supabase.co";
const SUPABASE_ANON_KEY = "TA_CLE_ANON_PUBLIC_ICI";
```

6. Dans **Authentication > URL Configuration**, ajoute ton URL de site dans :
   - Site URL
   - Redirect URLs

7. Dans **Database > Replication / Realtime**, active Realtime pour :
   - `messages`
   - `invitations`
   - `friend_requests`
   - `conversations`

## Test local

Utilise un petit serveur local, pas l'ouverture directe `file://`.

```bash
python3 -m http.server 8080
```

Puis ouvre `http://localhost:8080`.

## Déploiement GitHub Pages

1. Crée un repository GitHub.
2. Ajoute `index.html`, `manifest.webmanifest`, `sw.js`.
3. Va dans **Settings > Pages**.
4. Source : `Deploy from a branch`.
5. Branche : `main`, dossier `/root`.
6. Mets l'URL GitHub Pages dans Supabase Auth > URL Configuration.

## Déploiement Vercel

1. Va sur Vercel.
2. Import GitHub repository.
3. Framework preset : `Other`.
4. Build command : vide.
5. Output directory : `.`.
6. Mets l'URL Vercel dans Supabase Auth > URL Configuration.

## Tester une invitation

1. Connecte-toi avec un compte A.
2. Crée ton profil.
3. Va dans Sorties.
4. Choisis une recommandation.
5. Clique `Inviter un ami`.
6. Crée le lien.
7. Ouvre le lien dans une fenêtre privée ou un autre navigateur.
8. Réponds avec un prénom temporaire.
9. Reviens sur le compte A > Discussion : le message système apparaît.

## Limites du MVP

- Les sorties sont fictives et statiques.
- Les messages sont surtout des notifications système, pas encore un vrai chat complet.
- Pas de push notifications.
- Pas de géolocalisation GPS.
- Pas d'anti-spam avancé pour les liens d'invitation.
- Les invitations publiques par token doivent être considérées comme accessibles à toute personne ayant le lien.

## Améliorations futures

- Ajouter géolocalisation et calcul de distance réel.
- Ajouter recherche d'événements via API locale.
- Ajouter Edge Functions pour valider plus strictement les invitations.
- Ajouter chat texte complet et pièces jointes.
- Ajouter notifications push Web Push.
- Ajouter modération et signalement.
