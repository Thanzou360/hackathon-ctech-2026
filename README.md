# Hackathon UniC’bon 2026 — IST, Libreville

Site web et API pour le Hackathon UniC’bon, du 13 au 15 novembre 2026 à Libreville. Le site met en avant l’innovation numérique au service des besoins gabonais et propose les parcours de préinscription, d’inscription d’équipe et de candidature au jury.

## Fonctionnalités

- Le serveur répartit aléatoirement les candidatures entre les équipes les moins remplies, jusqu’à 20 équipes de 5 personnes.
- Le premier membre affecté devient chef d’équipe. À la complétion de son équipe, il reçoit un lien individuel valable 7 jours pour inscrire l’équipe.
- Le lien ne peut servir qu’une fois. L’organisation peut consulter les équipes et renvoyer un lien expiré ou non reçu.
- Les candidatures au jury sont enregistrées et peuvent notifier l’organisation par e-mail.
- Les données sont conservées dans une base SQLite, et non dans le navigateur des participants.
- Les entrées sont validées côté serveur, les doublons sont refusés et les API publiques sont limitées en débit.

## Installation et démarrage

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
