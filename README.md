# Hackathon C-Tech 2026 — Innover pour le Gabon

Site web du Hackathon C-Tech 2026, organisé par le Club de Technologie C-Tech en collaboration avec l’IST, du 13 au 15 novembre 2026 au Cap Estérias. Le site met en avant l’innovation numérique au service des besoins gabonais et propose les parcours de préinscription, d’inscription d’équipe et de candidature au jury.

## Fonctionnalités

- Le serveur répartit aléatoirement les candidatures entre les équipes les moins remplies, jusqu’à 20 équipes de 5 personnes.
- Le premier membre affecté devient chef d’équipe. À la complétion de son équipe, il reçoit un lien individuel valable 7 jours pour inscrire l’équipe.
- Le lien ne peut servir qu’une fois. L’organisation peut consulter les équipes et renvoyer un lien expiré ou non reçu.
- Les candidatures au jury sont enregistrées et peuvent notifier l’organisation par e-mail.
- Les données sont conservées dans une base SQLite, et non dans le navigateur des participants.
- Les entrées sont validées côté serveur, les doublons sont refusés et les API publiques sont limitées en débit.

## Mise en ligne sur GitHub Pages avec Supabase (recommandé)

GitHub Pages ne peut héberger que des pages fixes : sans base de données, aucune inscription ne serait partagée entre les candidats. Le site utilise donc une base **Supabase** gratuite, à laquelle il accède uniquement par des fonctions sécurisées (`supabase/schema.sql`).

1. Créer un compte sur [supabase.com](https://supabase.com), puis un projet (région la plus proche, par exemple Europe).
2. Dans le projet : **SQL Editor → New query**, coller tout le contenu de `supabase/schema.sql`, puis **Run**.
3. Toujours dans le SQL Editor, définir le mot de passe de l’espace organisation (12 caractères minimum) :
   ```sql
   select public.hk_set_admin_password('choisir-un-mot-de-passe-long');
   ```
4. Dans **Project Settings → API**, copier la **Project URL** et la clé **anon public**, puis les coller dans `js/config.js` :
   ```js
   const SUPABASE_URL = 'https://xxxxxxxx.supabase.co';
   const SUPABASE_ANON_KEY = 'eyJ...';
   ```
   La clé *anon* est prévue pour être publique : les tables sont fermées et seules les fonctions du script sont autorisées. Ne jamais publier la clé *service_role*.
5. Publier sur GitHub. Tant que ces deux valeurs sont vides, le formulaire public reste désactivé avec un message invitant à contacter le Club C-Tech.

### Parcours
- Le candidat se préinscrit ; la base le place au hasard dans l’équipe la moins remplie (20 équipes de 5, 100 places, du 19 octobre au 6 novembre 2026). Le premier membre d’une équipe en devient le chef.
- Quand une équipe est complète, l’organisation ouvre `admin.html`, clique sur **Créer le lien du chef** et l’envoie par WhatsApp ou e-mail (boutons préremplis). Le lien est personnel, valable 7 jours et utilisable une seule fois.
- Le chef complète le dossier d’équipe ; l’organisation le **valide** depuis l’espace organisation, qui permet aussi d’exporter la liste des participants (CSV).
- L’espace organisation permet de **supprimer** un participant (doublon, test, désistement) ou une candidature jury : la place est libérée, le membre suivant devient chef si besoin, et une équipe complète est rouverte.
- Mise à jour de la base : il suffit de recoller la dernière version de `supabase/schema.sql` dans le SQL Editor et de cliquer sur **Run** ; les inscriptions et le mot de passe sont conservés.
- Dates d’ouverture et de clôture modifiables dans la table `hk_settings` (colonnes `opens_at`, `closes_at`).

## Serveur Node (développement local)

### Installation et démarrage

Node.js 20 ou une version ultérieure est requis.

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd start
```

Ouvrir ensuite [http://localhost:3000](http://localhost:3000). Le serveur sert le site et son API à la même origine. La configuration de `js/config.js` s’adapte automatiquement à cette origine.

La première préinscription crée les 20 équipes. Les participants suivants sont répartis aléatoirement parmi celles qui comptent le moins de membres ; les équipes complètes ne reçoivent plus de nouveaux membres.

Ne lance pas le site avec une extension de serveur statique séparée (par exemple Live Server) sans configurer l’adresse de l’API : dans ce cas, le formulaire tenterait d’envoyer les données à l’adresse du serveur statique au lieu du backend.

### Site et API hébergés séparément

Si le site est servi par une autre origine, définir `window.HK_API_URL` dans un script placé avant `js/config.js`, avec l’adresse publique de l’API, et régler `WEB_ORIGIN` dans le `.env` du backend à l’origine exacte du site. Exemple pour un site sur `http://localhost:5500` et une API sur `http://localhost:3000` :

```html
<script>window.HK_API_URL = "http://localhost:3000";</script>
<script src="js/config.js"></script>
```

En production, ces deux adresses doivent utiliser HTTPS. Si l’API ne répond pas, le formulaire affiche désormais une erreur qui précise l’adresse ou le statut HTTP concerné.

## Courriels et configuration de production

Renseigner `.env` avant le lancement :

- `PUBLIC_URL` : URL publique HTTPS du site, utilisée pour créer les liens d’invitation. Ne pas la laisser sur `localhost` en production.
- `ADMIN_API_KEY` : secret aléatoire d’au moins 32 octets, à conserver uniquement côté serveur. Génération possible avec `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` et `SMTP_FROM` : paramètres fournis par le service de messagerie.
- `ORGANIZER_EMAIL` : boîte de réception des candidatures du jury.
- `DATABASE_PATH` : emplacement persistant de la base SQLite (par défaut `./data/hackathon.sqlite`).

Sans SMTP, les préinscriptions et candidatures restent enregistrées, mais le serveur indique explicitement que les courriels n’ont pas été envoyés. Les liens d’équipe peuvent alors être renvoyés après configuration de SMTP. Ne publiez jamais `.env`, la base de données ou des identifiants dans les fichiers statiques.

## Gestion des invitations par l’organisation

Les deux opérations exigent l’en-tête `x-admin-key`. Dans PowerShell, après avoir remplacé la valeur par la clé définie dans `.env` :

```powershell
$headers = @{ "x-admin-key" = "VOTRE_CLE_ADMIN" }
Invoke-RestMethod -Uri "http://localhost:3000/api/admin/teams" -Headers $headers
Invoke-RestMethod -Method Post -Uri "http://localhost:3000/api/admin/team-invitations/resend" -Headers $headers -ContentType "application/json" -Body '{"teamId":1}'
```

La première requête renvoie les identifiants et états des équipes. Utiliser l’identifiant de l’équipe à relancer dans la seconde requête. Protéger l’accès administrateur et utiliser HTTPS en production.

## Mode démonstration et tests

Si une page est ouverte directement avec `file://`, les formulaires utilisent le stockage de ce navigateur uniquement : aucune demande n’est transmise à l’organisation et les fonctions d’équipe nécessitent le serveur.

```powershell
npm.cmd test
```
