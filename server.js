'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const nodemailer = require('nodemailer');
const Database = require('better-sqlite3');

const ROOT = __dirname;
const TEAM_SIZE = 5;
const MAX_TEAMS = 20;
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ALLOWED_DAYS = new Set([
  'Jour 1 (vendredi)',
  'Jour 2 (samedi)',
  'Jour 3 (dimanche)'
]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function createDatabase(filename) {
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY,
      code INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL CHECK (status IN ('collecting', 'awaiting_team_info', 'confirmed')),
      fil TEXT NOT NULL DEFAULT '',
      tel TEXT NOT NULL DEFAULT '',
      idea TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      submitted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY,
      team_id INTEGER NOT NULL REFERENCES teams(id),
      name TEXT NOT NULL,
      fil TEXT NOT NULL,
      mail TEXT NOT NULL UNIQUE COLLATE NOCASE,
      tel TEXT NOT NULL,
      is_leader INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS participants_team_id_idx ON participants(team_id);

    CREATE TABLE IF NOT EXISTS invitations (
      team_id INTEGER PRIMARY KEY REFERENCES teams(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS jury_applications (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      organization TEXT NOT NULL,
      mail TEXT NOT NULL UNIQUE COLLATE NOCASE,
      tel TEXT NOT NULL DEFAULT '',
      expertise TEXT NOT NULL DEFAULT '',
      days TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function createMailer(env = process.env) {
  const from = (env.SMTP_FROM || env.MAIL_FROM || '').replace(/^["']|["']$/g, '');
  const configured = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']
    .some(key => Boolean(env[key])) || Boolean(from);
  if (!configured) return null;

  const required = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const missing = required.filter(key => !env[key]);
  if (!from) missing.push('SMTP_FROM');
  const port = Number(env.SMTP_PORT || (env.SMTP_SECURE === 'true' ? 465 : 587));
  if (missing.length || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Configuration SMTP invalide. Vérifiez : ${missing.join(', ') || 'SMTP_PORT'}.`);
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE === 'true' || port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS }
  });

  const organizerEmail = env.ORGANIZER_EMAIL || env.SMTP_USER || from;

  return {
    sendInvitation: (to, url, teamName) => transport.sendMail({
      from,
      to,
      subject: `Finalisez l’inscription de ${teamName} — Hackathon UniC’bon`,
      text: `Votre équipe ${teamName} est complète. Finalisez son inscription dans les 7 jours : ${url}`,
      html: `
        <div style="font-family:'Segoe UI',system-ui,sans-serif;background-color:#050F0B;color:#EAF4EE;padding:32px 20px;border-radius:12px;max-width:580px;margin:0 auto;border:1px solid rgba(255,255,255,0.12);">
          <div style="text-align:center;margin-bottom:24px;">
            <h1 style="color:#FFC829;font-size:24px;margin:0;letter-spacing:-0.5px;">Hackathon UniC’bon 2026</h1>
            <p style="color:#9DB5A9;font-size:14px;margin:6px 0 0;">IST × Club C-Tech · Libreville, Gabon</p>
          </div>
          <div style="background-color:#0D2219;padding:24px;border-radius:10px;border:1px solid rgba(31,211,138,0.25);">
            <h2 style="color:#1FD38A;font-size:18px;margin-top:0;">Félicitations, ${teamName} est au complet !</h2>
            <p style="color:#EAF4EE;font-size:15px;line-height:1.6;">
              En tant que premier préinscrit de votre groupe, vous avez été désigné <strong>chef d’équipe</strong>. Votre équipe compte désormais ses 5 participants.
            </p>
            <p style="color:#EAF4EE;font-size:15px;line-height:1.6;">
              Pour confirmer la participation de votre équipe au hackathon du 13 au 15 novembre 2026, cliquez sur le bouton ci-dessous pour finaliser l’inscription (lien personnel valable 7 jours) :
            </p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${url}" style="background-color:#FFC829;color:#050F0B;font-weight:800;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:999px;display:inline-block;">
                Finaliser l’inscription de ${teamName} →
              </a>
            </div>
            <p style="color:#9DB5A9;font-size:13px;line-height:1.5;margin-bottom:0;">
              Si le bouton ne s’affiche pas, copiez ce lien dans votre navigateur :<br>
              <a href="${url}" style="color:#1FD38A;word-break:break-all;">${url}</a>
            </p>
          </div>
          <p style="text-align:center;color:#5f7a6d;font-size:12px;margin-top:24px;">
            Hackathon UniC’bon 2026 · Université Internationale Brice Clotaire Oligui Nguema du Cap · Libreville
          </p>
        </div>
      `
    }),
    sendJuryNotification: application => {
      if (!organizerEmail) return Promise.resolve(false);
      return transport.sendMail({
        from,
        to: organizerEmail,
        subject: 'Nouvelle candidature au jury — Hackathon UniC’bon',
        text: [
          `Nom : ${application.name}`,
          `Organisation : ${application.organization}`,
          `E-mail : ${application.mail}`,
          `Téléphone : ${application.tel || 'non renseigné'}`,
          `Expertise : ${application.expertise || 'non renseignée'}`,
          `Disponibilités : ${application.days.join(', ') || 'non renseignées'}`
        ].join('\n')
      }).then(() => true);
    },
    sendJuryConfirmation: (to, name) => transport.sendMail({
      from,
      to,
      subject: 'Confirmation de candidature au jury — Hackathon UniC’bon 2026',
      text: `Bonjour ${name},\n\nNous avons bien reçu votre candidature pour rejoindre le jury du Hackathon UniC’bon 2026.\nL’organisation va l’examiner et reviendra vers vous très prochainement.\n\nCordialement,\nL’équipe d’organisation IST & Club C-Tech`,
      html: `
        <div style="font-family:'Segoe UI',system-ui,sans-serif;background-color:#050F0B;color:#EAF4EE;padding:28px 20px;border-radius:12px;max-width:580px;margin:0 auto;border:1px solid rgba(255,255,255,0.12);">
          <h2 style="color:#FFC829;margin-top:0;">Hackathon UniC’bon 2026</h2>
          <p>Bonjour <strong>${name}</strong>,</p>
          <p>Nous avons bien reçu votre candidature pour rejoindre le jury du hackathon.</p>
          <p>L’organisation (IST & Club C-Tech) vous remercie vivement pour votre engagement au service de la jeunesse et de l’innovation au Gabon. Nous reviendrons vers vous dans les meilleurs délais.</p>
          <p style="color:#9DB5A9;font-size:13px;margin-top:20px;">L’équipe d’organisation Hackathon UniC’bon 2026</p>
        </div>
      `
    }).catch(() => false)
  };
}

function cleanString(value, field, { required = true, max = 160 } = {}) {
  if (typeof value !== 'string') {
    if (!required && (value == null || value === '')) return '';
    throw new HttpError(400, `Le champ « ${field} » est invalide.`);
  }
  const result = value.trim();
  if (required && !result) throw new HttpError(400, `Le champ « ${field} » est obligatoire.`);
  if (result.length > max) throw new HttpError(400, `Le champ « ${field} » dépasse la longueur autorisée.`);
  return result;
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'Le corps de la requête doit être un objet JSON.');
  }
  return value;
}

function cleanEmail(value) {
  const email = cleanString(value, 'e-mail', { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Veuillez saisir une adresse e-mail valide.');
  }
  return email;
}

function cleanPhone(value, required = true) {
  const phone = cleanString(value, 'téléphone', { required, max: 32 });
  if (!phone) return '';
  const digits = phone.replace(/[\s().-]/g, '');
  if (!/^(?:\+?241|00241)?0?[0-9]{8}$/.test(digits)) {
    throw new HttpError(400, 'Saisissez un numéro gabonais valide (8 ou 9 chiffres, avec ou sans indicatif +241).');
  }
  return digits;
}

function parseParticipant(body) {
  requireObject(body);
  return {
    name: cleanString(body.name, 'nom', { max: 100 }),
    fil: cleanString(body.fil, 'filière', { max: 100 }),
    mail: cleanEmail(body.mail),
    tel: cleanPhone(body.tel)
  };
}

function invitationHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createApp({
  db,
  mailer = null,
  publicUrl = 'http://localhost:3000',
  webOrigin = '',
  adminApiKey = '',
  adminUser = '',
  adminPassword = '',
  logErrors = true
}) {
  if (!db) throw new Error('Une base de données est requise.');
  if (adminApiKey && Buffer.byteLength(adminApiKey) < 32) {
    throw new Error('ADMIN_API_KEY doit contenir au moins 32 octets aléatoires.');
  }
  const app = express();
  const baseUrl = new URL(publicUrl);
  if (!['http:', 'https:'].includes(baseUrl.protocol)) {
    throw new Error('PUBLIC_URL doit utiliser HTTP ou HTTPS.');
  }
  let allowedWebOrigin = '';
  if (webOrigin) {
    const parsedWebOrigin = new URL(webOrigin);
    if (!['http:', 'https:'].includes(parsedWebOrigin.protocol) || parsedWebOrigin.origin !== webOrigin) {
      throw new Error('WEB_ORIGIN doit être une origine HTTP(S) sans chemin.');
    }
    allowedWebOrigin = parsedWebOrigin.origin;
  }
  const siteUrl = baseUrl.origin;
  const participantLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
  const teamLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false });
  const juryLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false });
  const lookupLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false });
  const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false });
  const requireAdmin = (req, _res, next) => {
    const supplied = req.get('x-admin-key') || '';
    if (adminApiKey && supplied) {
      const expectedBuffer = Buffer.from(adminApiKey);
      const suppliedBuffer = Buffer.from(supplied);
      if (expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
        return next();
      }
    }

    const authHeader = req.get('authorization') || '';
    if (authHeader.startsWith('Basic ')) {
      try {
        const credentials = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf8');
        const [u, ...pParts] = credentials.split(':');
        const p = pParts.join(':');
        const expectedUser = adminUser || 'admin';
        const expectedPass = adminPassword || 'ctech1994';
        if (u === expectedUser && p === expectedPass) {
          return next();
        }
      } catch {}
    }
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (adminApiKey && token) {
        const expectedBuffer = Buffer.from(adminApiKey);
        const suppliedBuffer = Buffer.from(token);
        if (expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
          return next();
        }
      }
    }

    const queryKey = req.query?.key || req.query?.adminKey;
    if (adminApiKey && queryKey) {
      const expectedBuffer = Buffer.from(adminApiKey);
      const suppliedBuffer = Buffer.from(String(queryKey));
      if (expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
        return next();
      }
    }

    if (!adminApiKey && !adminUser) {
      return next(new HttpError(503, 'La fonction administrateur n’est pas configurée.'));
    }
    return next(new HttpError(401, 'Clé administrateur invalide.'));
  };

  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", allowedWebOrigin, 'http://localhost:*', 'http://127.0.0.1:*'].filter(Boolean),
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"]
      }
    }
  }));
  app.use('/api', (req, res, next) => {
    const origin = req.get('Origin');
    const isLocalOrigin = origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    const allowThisOrigin = (origin && origin === allowedWebOrigin) || (!allowedWebOrigin && isLocalOrigin);
    if (allowThisOrigin) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Vary', 'Origin');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Key, Authorization');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(allowThisOrigin ? 204 : 403);
    next();
  });
  app.use(express.json({ limit: '20kb', strict: true }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, mailConfigured: Boolean(mailer) });
  });

  app.post('/api/participants', participantLimiter, (req, res, next) => {
    try {
      const participant = parseParticipant(req.body);
      if (db.prepare('SELECT 1 FROM participants WHERE mail = ? COLLATE NOCASE').get(participant.mail)) {
        throw new HttpError(409, 'Cette adresse e-mail a déjà été utilisée pour une préinscription.');
      }

      const now = new Date().toISOString();
      const assign = db.transaction(() => {
        const totalTeams = db.prepare('SELECT COUNT(*) AS total FROM teams').get().total;
        if (totalTeams === 0) {
          const insertTeam = db.prepare("INSERT INTO teams (code, status, created_at) VALUES (?, 'collecting', ?)");
          for (let code = 1; code <= MAX_TEAMS; code += 1) insertTeam.run(code, now);
        }
        let available = db.prepare(`
          SELECT t.id, t.code, COUNT(p.id) AS member_count
          FROM teams t
          LEFT JOIN participants p ON p.team_id = t.id
          WHERE t.status = 'collecting'
          GROUP BY t.id
          HAVING member_count < ?
          ORDER BY member_count ASC
        `).all(TEAM_SIZE);

        if (!available.length) throw new HttpError(409, 'Les 20 équipes sont complètes. Les inscriptions sont closes.');

        const smallest = available[0].member_count;
        const tied = available.filter(team => team.member_count === smallest);
        const selected = tied[crypto.randomInt(tied.length)];
        const isLeader = selected.member_count === 0;
        db.prepare(`
          INSERT INTO participants (team_id, name, fil, mail, tel, is_leader, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(selected.id, participant.name, participant.fil, participant.mail, participant.tel, Number(isLeader), now);

        const memberCount = selected.member_count + 1;
        let rawToken = null;
        if (memberCount === TEAM_SIZE) {
          rawToken = crypto.randomBytes(32).toString('base64url');
          const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
          db.prepare("UPDATE teams SET status = 'awaiting_team_info' WHERE id = ?").run(selected.id);
          db.prepare(`
            INSERT INTO invitations (team_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?)
          `).run(selected.id, invitationHash(rawToken), expiresAt, now);
        }
        const leaderMail = db.prepare('SELECT mail FROM participants WHERE team_id = ? AND is_leader = 1').get(selected.id).mail;
        return { teamId: selected.id, teamCode: selected.code, isLeader, memberCount, rawToken, leaderMail };
      });

      const assigned = assign();
      const teamName = `Équipe ${String(assigned.teamCode).padStart(2, '0')}`;
      const response = {
        ok: true,
        emailSent: false,
        assignment: { name: teamName, memberCount: assigned.memberCount, isLeader: assigned.isLeader }
      };
      if (assigned.rawToken && mailer) {
        const invitationUrl = `${siteUrl}/inscription.html?invite=${encodeURIComponent(assigned.rawToken)}`;
        Promise.resolve().then(() => mailer.sendInvitation(assigned.leaderMail, invitationUrl, teamName)).then(() => {
          res.json({
            ...response,
            emailSent: true,
            message: `Tu as été affecté(e) à ${teamName}. L’équipe est complète et le lien d’inscription a été envoyé à son chef.`
          });
        }).catch(error => {
          if (logErrors) console.error('Échec de l’envoi d’une invitation d’équipe :', error.message);
          res.json({
            ...response,
            message: `Tu as été affecté(e) à ${teamName}. L’équipe est complète, mais l’envoi du lien a échoué ; l’organisation doit le renvoyer.`
          });
        });
      } else {
        const message = assigned.rawToken
          ? `Tu as été affecté(e) à ${teamName}. L’équipe est complète, mais le courriel n’est pas configuré ; contacte l’organisation pour recevoir le lien.`
          : `Ta préinscription est enregistrée dans ${teamName} (${assigned.memberCount}/${TEAM_SIZE} membres).`;
        res.json({ ...response, message });
      }
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/team-invitations/:token', lookupLimiter, (req, res, next) => {
    try {
      res.set('Cache-Control', 'no-store');
      const token = cleanString(req.params.token, 'lien', { max: 100 });
      const invitation = db.prepare(`
        SELECT i.expires_at, i.used_at, t.id AS team_id, t.code, t.status,
               leader.name AS leader_name, leader.mail AS leader_mail,
               leader.tel AS leader_tel, leader.fil AS leader_fil
        FROM invitations i
        JOIN teams t ON t.id = i.team_id
        JOIN participants leader ON leader.team_id = t.id AND leader.is_leader = 1
        WHERE i.token_hash = ?
      `).get(invitationHash(token));
      if (!invitation) throw new HttpError(404, 'Ce lien d’invitation est invalide.');
      if (invitation.used_at || invitation.status === 'confirmed') {
        throw new HttpError(409, 'Cette équipe a déjà finalisé son inscription.');
      }
      if (Date.parse(invitation.expires_at) <= Date.now()) {
        throw new HttpError(410, 'Ce lien d’invitation a expiré. Contactez l’organisation pour en recevoir un nouveau.');
      }

      const members = db.prepare(`
        SELECT name FROM participants WHERE team_id = ? AND is_leader = 0 ORDER BY id
      `).all(invitation.team_id);
      res.json({
        data: {
          assignedTeam: `Équipe ${String(invitation.code).padStart(2, '0')}`,
          name: invitation.leader_name,
          mail: invitation.leader_mail,
          tel: invitation.leader_tel,
          fil: invitation.leader_fil,
          members: members.map(member => ({ name: member.name }))
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/teams', teamLimiter, (req, res, next) => {
    try {
      const body = requireObject(req.body);
      const token = cleanString(body.invitationToken, 'lien d’invitation', { max: 100 });
      const fil = cleanString(body.fil, 'filière principale', { max: 100 });
      const tel = cleanPhone(body.tel);
      const idea = cleanString(body.idee, 'idée de projet', { required: false, max: 2000 });
      const now = new Date().toISOString();
      const register = db.transaction(() => {
        const invitation = db.prepare(`
          SELECT i.team_id, i.expires_at, i.used_at, t.status, t.code
          FROM invitations i JOIN teams t ON t.id = i.team_id
          WHERE i.token_hash = ?
        `).get(invitationHash(token));
        if (!invitation) throw new HttpError(404, 'Ce lien d’invitation est invalide.');
        if (invitation.used_at || invitation.status === 'confirmed') {
          throw new HttpError(409, 'Cette équipe a déjà finalisé son inscription.');
        }
        if (Date.parse(invitation.expires_at) <= Date.now()) {
          throw new HttpError(410, 'Ce lien d’invitation a expiré. Contactez l’organisation pour en recevoir un nouveau.');
        }
        const memberCount = db.prepare('SELECT COUNT(*) AS total FROM participants WHERE team_id = ?').get(invitation.team_id).total;
        if (memberCount !== TEAM_SIZE) throw new HttpError(409, 'L’équipe doit compter exactement cinq membres avant sa validation.');

        db.prepare(`
          UPDATE teams SET status = 'confirmed', fil = ?, tel = ?, idea = ?, submitted_at = ?
          WHERE id = ?
        `).run(fil, tel, idea, now, invitation.team_id);
        db.prepare('UPDATE invitations SET used_at = ? WHERE team_id = ?').run(now, invitation.team_id);
        return { name: `Équipe ${String(invitation.code).padStart(2, '0')}` };
      });

      const team = register();
      res.json({ ok: true, team, message: 'L’inscription de l’équipe est enregistrée.' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/jury', juryLimiter, async (req, res, next) => {
    try {
      const body = requireObject(req.body);
      const application = {
        name: cleanString(body.name, 'nom', { max: 100 }),
        organization: cleanString(body.org, 'organisation et fonction', { max: 160 }),
        mail: cleanEmail(body.mail),
        tel: cleanPhone(body.tel, false),
        expertise: cleanString(body.exp, 'expertise', { required: false, max: 200 }),
        days: body.days == null ? [] : body.days
      };
      if (!Array.isArray(application.days) || application.days.some(day => !ALLOWED_DAYS.has(day))) {
        throw new HttpError(400, 'Les disponibilités sélectionnées sont invalides.');
      }
      if (db.prepare('SELECT 1 FROM jury_applications WHERE mail = ? COLLATE NOCASE').get(application.mail)) {
        throw new HttpError(409, 'Une candidature existe déjà pour cette adresse e-mail.');
      }

      db.prepare(`
        INSERT INTO jury_applications (name, organization, mail, tel, expertise, days, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(application.name, application.organization, application.mail, application.tel, application.expertise, JSON.stringify(application.days), new Date().toISOString());

      let emailSent = false;
      if (mailer && mailer.sendJuryNotification) {
        try {
          emailSent = await mailer.sendJuryNotification(application);
        } catch (error) {
          if (logErrors) console.error('Échec de la notification d’une candidature jury :', error.message);
        }
      }
      if (mailer && mailer.sendJuryConfirmation) {
        mailer.sendJuryConfirmation(application.mail, application.name).catch(() => {});
      }
      res.json({
        ok: true,
        emailSent,
        message: emailSent
          ? 'Ta candidature est enregistrée et l’organisation a été notifiée.'
          : 'Ta candidature est enregistrée. La notification e-mail de l’organisation n’est pas disponible.'
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/auth', adminLimiter, requireAdmin, (_req, res) => {
    res.json({ ok: true, message: 'Authentification administrateur réussie.' });
  });

  app.get('/api/admin/teams', adminLimiter, requireAdmin, (_req, res, next) => {
    try {
      const teams = db.prepare(`
        SELECT t.id, t.code, t.status, t.fil, t.tel, t.idea, t.created_at, t.submitted_at,
               leader.name AS leader_name, leader.mail AS leader_mail, leader.tel AS leader_tel, leader.fil AS leader_fil,
               COUNT(p.id) AS member_count,
               i.token_hash, i.expires_at, i.used_at
        FROM teams t
        LEFT JOIN participants p ON p.team_id = t.id
        LEFT JOIN participants leader ON leader.team_id = t.id AND leader.is_leader = 1
        LEFT JOIN invitations i ON i.team_id = t.id
        GROUP BY t.id
        ORDER BY t.code
      `).all().map(team => {
        const members = db.prepare(`
          SELECT id, name, fil, mail, tel, is_leader, created_at
          FROM participants
          WHERE team_id = ?
          ORDER BY is_leader DESC, id ASC
        `).all(team.id);
        return {
          ...team,
          name: `Équipe ${String(team.code).padStart(2, '0')}`,
          members
        };
      });
      res.set('Cache-Control', 'no-store');
      res.json({ teams });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/admin/jury', adminLimiter, requireAdmin, (_req, res, next) => {
    try {
      const applications = db.prepare(`
        SELECT id, name, organization, mail, tel, expertise, days, created_at
        FROM jury_applications
        ORDER BY id DESC
      `).all().map(app => {
        let days = [];
        try { days = JSON.parse(app.days || '[]'); } catch {}
        return { ...app, days };
      });
      res.set('Cache-Control', 'no-store');
      res.json({ applications });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/admin/team-invitations/resend', adminLimiter, requireAdmin, async (req, res, next) => {
    try {
      if (!mailer) throw new HttpError(503, 'Le service de courriel SMTP n’est pas configuré.');
      const body = requireObject(req.body);
      const teamId = Number(body.teamId);
      if (!Number.isSafeInteger(teamId) || teamId < 1) throw new HttpError(400, 'Identifiant d’équipe invalide.');
      const team = db.prepare(`
        SELECT t.id, t.code, t.status, leader.mail
        FROM teams t JOIN participants leader ON leader.team_id = t.id AND leader.is_leader = 1
        WHERE t.id = ?
      `).get(teamId);
      if (!team || team.status !== 'awaiting_team_info') {
        throw new HttpError(404, 'Aucune invitation en attente pour cette équipe.');
      }

      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
      const teamName = `Équipe ${String(team.code).padStart(2, '0')}`;
      const invitationUrl = `${siteUrl}/inscription.html?invite=${encodeURIComponent(token)}`;
      await mailer.sendInvitation(team.mail, invitationUrl, teamName);
      db.prepare(`
        UPDATE invitations SET token_hash = ?, expires_at = ?, used_at = NULL, created_at = ?
        WHERE team_id = ?
      `).run(invitationHash(token), expiresAt, new Date().toISOString(), team.id);
      res.json({ ok: true, emailSent: true, message: `Le lien de ${teamName} a été renvoyé au chef d’équipe.` });
    } catch (error) {
      if (error instanceof HttpError) return next(error);
      if (logErrors) console.error('Échec du renvoi d’une invitation :', error.message);
      next(new HttpError(502, 'Le courriel n’a pas pu être envoyé. Le lien existant reste valide.'));
    }
  });

  app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'index.html')));
  for (const page of ['index.html', 'inscription.html', 'jury.html', 'admin.html']) {
    app.get(`/${page}`, (_req, res) => res.sendFile(path.join(ROOT, page)));
  }
  app.get('/admin', (_req, res) => res.sendFile(path.join(ROOT, 'admin.html')));
  for (const directory of ['css', 'js', 'assets']) {
    app.use(`/${directory}`, express.static(path.join(ROOT, directory), { index: false, dotfiles: 'deny' }));
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Point d’API introuvable.' }));
  app.use((_req, res) => res.status(404).type('text').send('Page introuvable.'));
  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Le corps de la requête JSON est invalide.' });
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message?.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'Cette adresse e-mail a déjà été utilisée.' });
    }
    if (logErrors) console.error('Erreur de requête :', error.message);
    return res.status(error.status >= 400 && error.status < 500 ? error.status : 500)
      .json({ error: error.status >= 400 && error.status < 500 ? error.message : 'Une erreur interne est survenue.' });
  });

  return app;
}

if (require.main === module) {
  require('dotenv').config();
  if (!process.env.SMTP_HOST && fs.existsSync(path.join(ROOT, 'backend', '.env'))) {
    require('dotenv').config({ path: path.join(ROOT, 'backend', '.env') });
  }
  const port = Number(process.env.PORT || 3000);
  const db = createDatabase(process.env.DATABASE_PATH || path.join(ROOT, 'data', 'hackathon.sqlite'));
  const mailer = createMailer();
  const app = createApp({
    db,
    mailer,
    publicUrl: process.env.PUBLIC_URL || `http://localhost:${port}`,
    webOrigin: process.env.WEB_ORIGIN || '',
    adminApiKey: process.env.ADMIN_API_KEY || '',
    adminUser: process.env.ADMIN_USER || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || 'ctech1994'
  });
  const server = app.listen(port, () => {
    console.log(`Hackathon UniC’bon disponible sur le port ${port} (http://localhost:${port}).`);
    if (mailer) {
      console.log('Service SMTP configuré avec succès.');
    } else {
      console.warn('SMTP non configuré : les invitations ne peuvent pas être envoyées.');
    }
    if (process.env.ADMIN_API_KEY || process.env.ADMIN_USER) {
      console.log(`Tableau de bord admin accessible sur http://localhost:${port}/admin`);
    } else {
      console.warn('ADMIN_API_KEY non configurée : le renvoi administrateur est désactivé.');
    }
  });
  const shutdown = () => server.close(() => {
    db.close();
    process.exit(0);
  });
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createApp, createDatabase };
