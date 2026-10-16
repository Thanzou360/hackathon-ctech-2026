'use strict';

const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const { createApp, createDatabase } = require('../server');

let db;
let server;
let baseUrl;
let invitations;

beforeEach(async () => {
  db = createDatabase(':memory:');
  invitations = [];
  const mailer = {
    sendInvitation(to, url, teamName) {
      invitations.push({ to, url, teamName });
      return Promise.resolve();
    },
    sendJuryNotification() {
      return Promise.resolve(true);
    }
  };
  server = createApp({
    db,
    mailer,
    publicUrl: 'https://hackathon.example',
    webOrigin: 'https://site.example',
    adminApiKey: 'test-admin-key-with-at-least-32-bytes',
    logErrors: false
  }).listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (db) db.close();
});

async function post(url, body, headers = {}) {
  return fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

function participant(index) {
  return {
    name: `Étudiant ${index}`,
    fil: 'Informatique',
    mail: `etudiant${index}@example.ga`,
    tel: String(60000000 + index)
  };
}

test('répartit 100 inscriptions dans 20 équipes et envoie chaque invitation au chef', async () => {
  const teamCounts = new Map();

  for (let index = 1; index <= 100; index += 1) {
    const response = await post('/api/participants', participant(index));
    assert.equal(response.status, 200);
    const result = await response.json();
    const teamName = result.assignment.name;
    teamCounts.set(teamName, (teamCounts.get(teamName) || 0) + 1);
  }

  assert.equal(teamCounts.size, 20);
  assert.deepEqual([...teamCounts.values()].sort(), Array(20).fill(5));
  assert.equal(invitations.length, 20);
  assert.equal(new URL(invitations[0].url).origin, 'https://hackathon.example');
  for (const invitation of invitations) {
    assert.ok(invitation.to.endsWith('@example.ga'));
    const code = Number(invitation.teamName.match(/\d+/)[0]);
    const leader = db.prepare(`
      SELECT p.mail FROM participants p JOIN teams t ON t.id = p.team_id
      WHERE t.code = ? AND p.is_leader = 1
    `).get(code);
    assert.equal(invitation.to, leader.mail);
  }

  const atCapacity = await post('/api/participants', participant(101));
  assert.equal(atCapacity.status, 409);
  assert.match((await atCapacity.json()).error, /20 équipes sont complètes/);
});

test('valide le lien et finalise une équipe une seule fois', async () => {
  for (let index = 1; index <= 100; index += 1) {
    const response = await post('/api/participants', participant(index));
    assert.equal(response.status, 200);
    await response.json();
  }

  const invitationUrl = new URL(invitations[0].url);
  const token = invitationUrl.searchParams.get('invite');
  const lookup = await fetch(`${baseUrl}/api/team-invitations/${encodeURIComponent(token)}`);
  assert.equal(lookup.status, 200);
  const { data } = await lookup.json();
  assert.equal(data.assignedTeam, invitations[0].teamName);
  assert.equal(data.members.length, 4);
  assert.equal(data.mail, invitations[0].to);

  const submission = {
    invitationToken: token,
    fil: 'Informatique et IA',
    tel: '+241 06 12 34 56',
    idee: 'Une application au service des communautés du Gabon.'
  };
  const result = await post('/api/teams', submission);
  assert.equal(result.status, 200);
  assert.equal((await result.json()).team.name, invitations[0].teamName);

  const reused = await post('/api/teams', submission);
  assert.equal(reused.status, 409);
});

test('permet à l’organisation de consulter les équipes et de renvoyer une invitation', async () => {
  for (let index = 1; index <= 100; index += 1) {
    const response = await post('/api/participants', participant(index));
    assert.equal(response.status, 200);
    await response.json();
  }

  const originalToken = new URL(invitations[0].url).searchParams.get('invite');
  const listing = await fetch(`${baseUrl}/api/admin/teams`, {
    headers: { 'x-admin-key': 'test-admin-key-with-at-least-32-bytes' }
  });
  const { teams } = await listing.json();
  assert.equal(teams.length, 20);
  assert.ok(teams.every(team => team.member_count === 5 && team.status === 'awaiting_team_info'));
  const targetTeam = teams.find(team => team.name === invitations[0].teamName);

  const resent = await post('/api/admin/team-invitations/resend', { teamId: targetTeam.id }, {
    'x-admin-key': 'test-admin-key-with-at-least-32-bytes'
  });
  assert.equal(resent.status, 200);
  assert.equal((await resent.json()).emailSent, true);

  const newToken = new URL(invitations.at(-1).url).searchParams.get('invite');
  assert.notEqual(newToken, originalToken);
  assert.equal((await fetch(`${baseUrl}/api/team-invitations/${originalToken}`)).status, 404);
  assert.equal((await fetch(`${baseUrl}/api/team-invitations/${newToken}`)).status, 200);
});

test('refuse un lien d’équipe expiré', async () => {
  for (let index = 1; index <= 100; index += 1) {
    const response = await post('/api/participants', participant(index));
    assert.equal(response.status, 200);
    await response.json();
  }

  const invitation = invitations[0];
  const token = new URL(invitation.url).searchParams.get('invite');
  const code = Number(invitation.teamName.match(/\d+/)[0]);
  db.prepare(`
    UPDATE invitations SET expires_at = '2020-01-01T00:00:00.000Z'
    WHERE team_id = (SELECT id FROM teams WHERE code = ?)
  `).run(code);

  const lookup = await fetch(`${baseUrl}/api/team-invitations/${token}`);
  assert.equal(lookup.status, 410);
  assert.equal(lookup.headers.get('cache-control'), 'no-store');
  const submission = await post('/api/teams', {
    invitationToken: token,
    fil: 'Informatique',
    tel: '06123456'
  });
  assert.equal(submission.status, 410);
});

test('valide les inscriptions gabonaises et bloque les doublons', async () => {
  const invalid = await post('/api/participants', { ...participant(1), tel: '123' });
  assert.equal(invalid.status, 400);
  assert.match((await invalid.json()).error, /numéro gabonais valide/);

  const accepted = await post('/api/participants', participant(1));
  assert.equal(accepted.status, 200);
  const duplicate = await post('/api/participants', { ...participant(2), mail: 'ETUDIANT1@example.ga' });
  assert.equal(duplicate.status, 409);
});

test('enregistre les candidatures jury et protège les opérations administrateur', async () => {
  const application = {
    name: 'Amina Innovation',
    org: 'Entreprise gabonaise, ingénieure',
    mail: 'amina@example.ga',
    tel: '+241 06 12 34 56',
    exp: 'Cybersécurité',
    days: ['Jour 1 (vendredi)', 'Jour 3 (dimanche)']
  };
  const jury = await post('/api/jury', application);
  assert.equal(jury.status, 200);
  assert.equal((await jury.json()).emailSent, true);
  const duplicate = await post('/api/jury', application);
  assert.equal(duplicate.status, 409);

  const denied = await fetch(`${baseUrl}/api/admin/teams`);
  assert.equal(denied.status, 401);
  const authorized = await fetch(`${baseUrl}/api/admin/teams`, {
    headers: { 'x-admin-key': 'test-admin-key-with-at-least-32-bytes' }
  });
  assert.equal(authorized.status, 200);
  assert.deepEqual((await authorized.json()).teams, []);
});

test('autorise les requêtes du site configuré et refuse les autres origines en pré-vol', async () => {
  const allowed = await fetch(`${baseUrl}/api/participants`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://site.example', 'Access-Control-Request-Method': 'POST' }
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://site.example');

  const denied = await fetch(`${baseUrl}/api/participants`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://attacker.example', 'Access-Control-Request-Method': 'POST' }
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});

test('accepte les numéros gabonais à 8 et 9 chiffres et permet l’accès jury/auth admin', async () => {
  const p9 = {
    name: 'Étudiant Neuf',
    fil: 'Réseaux',
    mail: 'neuf@example.ga',
    tel: '065369629' // 9 chiffres gabonais avec zéro
  };
  const res9 = await post('/api/participants', p9);
  assert.equal(res9.status, 200);

  const authRes = await fetch(`${baseUrl}/api/admin/auth`, {
    headers: { 'x-admin-key': 'test-admin-key-with-at-least-32-bytes' }
  });
  assert.equal(authRes.status, 200);

  const juryRes = await fetch(`${baseUrl}/api/admin/jury`, {
    headers: { 'x-admin-key': 'test-admin-key-with-at-least-32-bytes' }
  });
  assert.equal(juryRes.status, 200);
  const juryData = await juryRes.json();
  assert.ok(Array.isArray(juryData.applications));
});

