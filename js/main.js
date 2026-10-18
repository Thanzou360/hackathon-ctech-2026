(() => {
const C = window.HK_CONFIG || {};
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page = document.body.dataset.page;
const readStorage = key => {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); }
  catch { throw new Error('Les données locales sont illisibles. Vérifie les réglages de stockage de ton navigateur.'); }
};
const writeStorage = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('Le navigateur ne peut pas enregistrer cette demande localement. Active le stockage ou réessaie depuis le site officiel.');
  }
};

function layout() {
  const cur = p => page === p ? ' aria-current="page"' : '';
  const header = $('#site-header');
  const footer = $('#site-footer');
  if (!header || !footer) return;
  header.innerHTML = `<div class="bar"><a class="brand" href="index.html"><img src="assets/logo.svg" alt="" width="40" height="40"><span>Hackathon UniC’bon<em>2026</em></span></a>
  <button class="burger" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="menu"><i></i><i></i></button>
  <nav id="menu" aria-label="Navigation principale"><a href="index.html#deroule">Déroulé</a><a href="index.html#faq">Questions</a><a href="jury.html"${cur('jury')}>Jury</a><a class="btn" href="inscription.html">Préinscription</a></nav></div>`;
  const contact = [C.CONTACT_EMAIL && `<a href="mailto:${esc(C.CONTACT_EMAIL)}">${esc(C.CONTACT_EMAIL)}</a>`, C.WHATSAPP && `<a href="https://wa.me/${esc(C.WHATSAPP)}">WhatsApp</a>`].filter(Boolean).join(' · ');
  footer.innerHTML = `<div class="wrap"><div class="ft">
    <div><strong>Hackathon UniC’bon 2026</strong><p>Du 13 au 15 novembre 2026<br>Université Internationale Brice Clotaire Oligui Nguema du Cap, Libreville</p></div>
    <div><h4>Navigation</h4><ul><li><a href="inscription.html">Préinscription</a></li><li><a href="jury.html">Rejoindre le jury</a></li><li><a href="index.html#deroule">Déroulé</a></li><li><a href="index.html#faq">Questions fréquentes</a></li><li><a href="admin.html">Espace organisation</a></li></ul></div>
    <div><h4>Organisation</h4><ul><li>Institut Supérieur de Technologie (IST)</li><li>Club C-Tech</li>${contact ? `<li>${contact}</li>` : ''}</ul></div>
  </div><div class="copy"><span>© 2026 Hackathon UniC’bon · IST</span><span>Libreville, Gabon</span></div></div>`;
  const b = $('.burger'), m = $('#menu');
  if (b && m) {
    b.onclick = () => { const o = m.classList.toggle('open'); b.setAttribute('aria-expanded', o); };
    m.addEventListener('click', e => { if (e.target.closest('a')) { m.classList.remove('open'); b.setAttribute('aria-expanded', false); } });
  }
  const hd = $('#site-header'), hero = $('.sunwrap');
  const sc = () => { if (hd) hd.classList.toggle('sc', scrollY > 8); if (hero && scrollY < 900) hero.style.setProperty('--py', scrollY * .18 + 'px'); };
  addEventListener('scroll', sc, { passive: true }); sc();
}

function countdown() {
  const box = $('#cd'); if (!box) return;
  const target = new Date(C.EVENT_DATE || '2026-11-13T08:00:00+01:00').getTime();
  const set = (k, v) => { const e = $('[data-u="' + k + '"]', box); if (e) e.textContent = String(v).padStart(2, '0'); };
  const tick = () => {
    const d = Math.max(0, target - Date.now());
    if (!d) { $('#cd-label').textContent = 'L’événement a commencé.'; }
    set('d', Math.floor(d / 864e5)); set('h', Math.floor(d / 36e5) % 24); set('m', Math.floor(d / 6e4) % 60); set('s', Math.floor(d / 1e3) % 60);
  };
  tick(); setInterval(tick, 1000);
}

function counters() {
  const els = document.querySelectorAll('[data-count]'); if (!els.length) return;
  if (!('IntersectionObserver' in window) || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return; io.unobserve(e.target);
    const el = e.target, n = +el.dataset.count, t0 = performance.now();
    const f = t => { const p = Math.min(1, (t - t0) / 1100); el.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }), { threshold: .25 });
  els.forEach(e => { e.textContent = '0'; io.observe(e); });
}

async function saveToSupabase(payload) {
  if (!C.SUPABASE_URL || !C.SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${C.SUPABASE_URL}/rest/v1/inscriptions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': C.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${C.SUPABASE_ANON_KEY}`,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } catch (e) {
    console.warn('[Hackathon] Supabase sync:', e);
    return false;
  }
}

async function sendEmailJs(templateParams) {
  if (!C.EMAILJS_SERVICE_ID || !C.EMAILJS_TEMPLATE_ID || !C.EMAILJS_PUBLIC_KEY) return null;
  try {
    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: C.EMAILJS_SERVICE_ID,
        template_id: C.EMAILJS_TEMPLATE_ID,
        user_id: C.EMAILJS_PUBLIC_KEY,
        template_params: templateParams
      })
    });
    return res.ok;
  } catch (e) {
    console.warn('[Hackathon] EmailJS notification:', e);
    return false;
  }
}

async function send(kind, data) {
  if (C.API_URL) {
    const apiUrl = C.API_URL.replace(/\/+$/, '');
    let response;
    try {
      response = await fetch(`${apiUrl}/api/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch {
      throw new Error(`Impossible de joindre le serveur d’inscription (${apiUrl}). Vérifie que le backend est démarré (npm.cmd start).`);
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Le serveur d’inscription a répondu dans un format inattendu (HTTP ${response.status}). Vérifie que l’API est bien démarrée à ${apiUrl}.`);
    }
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('Trop de requêtes envoyées récemment. Patiente quelques minutes avant de réessayer.');
      }
      throw new Error(result.error || `L’API a refusé la demande (HTTP ${response.status}).`);
    }
    return result;
  }

  // Mode Cloud Supabase & EmailJS (partagé avec C-Tech)
  if (kind === 'participants') {
    const parts = readStorage('hk-demo-participants') || [];
    if (!Array.isArray(parts)) writeStorage('hk-demo-participants', []);
    if (parts.some(x => x.mail === data.mail)) {
      throw new Error('Cette adresse e-mail a déjà été utilisée pour une préinscription.');
    }
    let teams = readStorage('hk-demo-teams');
    if (!Array.isArray(teams) || teams.length !== 20) {
      teams = Array.from({ length: 20 }, (_, i) => ({
        id: i + 1,
        code: i + 1,
        name: `Équipe ${String(i + 1).padStart(2, '0')}`,
        status: 'collecting',
        members: []
      }));
    }
    const available = teams.filter(t => t.status === 'collecting' && t.members.length < 5);
    if (!available.length) throw new Error('Les 20 équipes sont complètes. Les inscriptions sont closes.');
    available.sort((a, b) => a.members.length - b.members.length);
    const minCount = available[0].members.length;
    const tied = available.filter(t => t.members.length === minCount);
    const chosen = tied[Math.floor(Math.random() * tied.length)];
    const isLeader = chosen.members.length === 0;
    const newMember = { ...data, is_leader: isLeader ? 1 : 0, created_at: new Date().toISOString() };
    chosen.members.push(newMember);
    parts.push({ ...newMember, team_id: chosen.id });
    writeStorage('hk-demo-participants', parts);

    let token = null;
    if (chosen.members.length === 5) {
      chosen.status = 'awaiting_team_info';
      token = 'demo_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      chosen.token = token;
      chosen.expires_at = new Date(Date.now() + 7 * 864e5).toISOString();
    }
    writeStorage('hk-demo-teams', teams);

    // Enregistrement cloud dans Supabase (table 'inscriptions' partagée)
    await saveToSupabase({
      nom: data.name,
      email: data.mail,
      filiere: data.fil,
      message: `[Hackathon UniC’bon 2026] Tél: ${data.tel || 'N/A'} | Équipe: ${chosen.name} | Rôle: ${isLeader ? 'Chef d\'équipe' : 'Membre'}`,
      source: 'formulaire'
    });

    // Envoi de la notification par EmailJS
    await sendEmailJs({
      from_name: data.name,
      from_email: data.mail,
      filiere: data.fil,
      niveau: isLeader ? "Chef d'équipe" : "Membre",
      interets: ["Hackathon UniC’bon 2026", chosen.name],
      message: `Nouvelle inscription Hackathon UniC’bon :\n• Nom : ${data.name}\n• E-mail : ${data.mail}\n• Tél : ${data.tel}\n• Filière : ${data.fil}\n• Équipe : ${chosen.name} (${chosen.members.length}/5)`,
      to_email: C.CONTACT_EMAIL || 'ctech2798@gmail.com',
      sent_at: new Date().toLocaleString('fr-FR')
    });

    return {
      ok: true,
      emailSent: true,
      assignment: {
        name: chosen.name,
        memberCount: chosen.members.length,
        isLeader
      },
      message: `Préinscription validée avec succès ! Tu es affecté(e) à ${chosen.name} (${chosen.members.length}/5 membres). L’organisation a été notifiée.`
    };
  }

  if (kind === 'teams') {
    const teams = readStorage('hk-demo-teams') || [];
    const team = teams.find(t => t.token === data.invitationToken);
    if (!team) throw new Error('Ce lien d’invitation est invalide ou introuvable.');
    if (team.status === 'confirmed') throw new Error('Cette équipe a déjà validé son inscription.');
    team.status = 'confirmed';
    team.fil = data.fil;
    team.tel = data.tel;
    team.idea = data.idee || '';
    team.submitted_at = new Date().toISOString();
    writeStorage('hk-demo-teams', teams);

    await saveToSupabase({
      nom: team.name,
      email: data.mail || team.mail || '',
      filiere: data.fil,
      message: `[Hackathon UniC’bon 2026 - Finalisation équipe] Tél: ${data.tel} | Idée: ${data.idee || 'Non renseignée'}`,
      source: 'formulaire'
    });

    return { ok: true, team: { name: team.name }, message: 'L’inscription complète de l’équipe a été validée et enregistrée !' };
  }

  const k = 'hk-demo-' + kind, a = readStorage(k) || [];
  if (!Array.isArray(a)) throw new Error('Données invalides.');
  if (a.some(x => x.mail === data.mail)) {
    throw new Error('Cette adresse e-mail a déjà été utilisée.');
  }
  a.push(data); writeStorage(k, a);

  await saveToSupabase({
    nom: data.name,
    email: data.mail,
    filiere: data.role || data.job || 'Jury',
    message: `[Hackathon UniC’bon 2026 - Candidature Jury] ${data.bio || ''} | Dispo: ${(data.days || []).join(', ')}`,
    source: 'formulaire'
  });

  return {
    ok: true,
    emailSent: true,
    message: 'Votre candidature a été transmise avec succès à l’organisation !'
  };
}

async function forms() {
  const participantForm = $('#participant-form');
  const teamForm = $('#team-form');
  if (!participantForm || !teamForm) {
    const juryForm = $('form[data-kind="jury"]');
    if (!juryForm) return;
    if (!C.API_URL && !C.SUPABASE_URL) {
      const demo = $('#demo'); if (demo) demo.hidden = false;
    }
    juryForm.addEventListener('submit', async e => {
      e.preventDefault();
      if (!juryForm.reportValidity()) return;
      const box = $('#feedback');
      box.className = ''; box.textContent = '';
      const fd = new FormData(juryForm), data = Object.fromEntries(fd.entries());
      data.mail = (data.mail || '').trim().toLowerCase();
      data.days = fd.getAll('day');
      const btn = $('button[type=submit]', juryForm); btn.disabled = true; btn.textContent = 'Envoi en cours…';
      try {
        const result = await send('jury', data);
        juryForm.hidden = true;
        const doneBox = $('#done');
        doneBox.hidden = false;
        const confirmation = result.message || (C.API_URL
          ? 'L’organisation a enregistré votre candidature.'
          : 'Candidature conservée sur cet appareil uniquement ; elle n’a pas été transmise à l’organisation.');
        doneBox.innerHTML = `
          <h2>Candidature reçue</h2>
          <p>Merci <strong>${esc(data.name)}</strong>.</p>
          <p style="margin-top:12px;color:var(--txt)">${esc(confirmation)}</p>
          <div style="margin-top:24px"><a class="btn ghost" href="index.html">← Retour à l’accueil</a></div>
        `;
        scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) {
        box.className = 'msg'; box.textContent = error.message || 'Une erreur est survenue.';
        btn.disabled = false; btn.textContent = btn.dataset.label;
      }
    });
    return;
  }
  if (!C.API_URL && !C.SUPABASE_URL) {
    const demo = $('#demo'); if (demo) demo.hidden = false;
  }

  const invitationToken = new URLSearchParams(location.search).get('invite');
  const title = $('#form-title');
  const intro = $('#form-intro');
  if (invitationToken) {
    participantForm.hidden = true;
    teamForm.hidden = false;
    title.textContent = 'Complète l’inscription de ton équipe';
    intro.textContent = 'Le lien personnel envoyé par l’organisation te permet de finaliser l’inscription de l’équipe qui t’a été attribuée.';
    $('[name="invitationToken"]', teamForm).value = invitationToken;
    const assignmentNote = $('#assignment-note');
    const teamButton = $('button[type=submit]', teamForm);
    try {
      let teamInfo;
      if (C.API_URL) {
        const response = await fetch(`${C.API_URL.replace(/\/$/, '')}/api/team-invitations/${encodeURIComponent(invitationToken)}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Ce lien d’invitation est invalide ou expiré.');
        teamInfo = result.data;
      } else {
        const teams = readStorage('hk-demo-teams') || [];
        const team = teams.find(t => t.token === invitationToken);
        if (!team) throw new Error('Ce lien d’invitation est invalide ou expiré (mode démonstration).');
        if (team.status === 'confirmed') throw new Error('Cette équipe a déjà finalisé son inscription.');
        const leader = (team.members && team.members.find(m => m.is_leader)) || team.members?.[0];
        const otherMembers = (team.members || []).filter(m => m !== leader);
        teamInfo = {
          assignedTeam: team.name,
          name: leader?.name || '',
          mail: leader?.mail || '',
          tel: leader?.tel || '',
          fil: leader?.fil || '',
          members: otherMembers.map(m => ({ name: m.name }))
        };
      }
      $('[name="name"]', teamForm).value = teamInfo.assignedTeam;
      $('[name="chef"]', teamForm).value = teamInfo.name;
      $('[name="mail"]', teamForm).value = teamInfo.mail;
      $('[name="tel"]', teamForm).value = teamInfo.tel || '';
      $('[name="fil"]', teamForm).value = teamInfo.fil || '';
      teamForm.querySelectorAll('[name="member"]').forEach((input, index) => {
        input.value = teamInfo.members[index]?.name || '';
      });
      assignmentNote.textContent = `Tu es le chef désigné de « ${teamInfo.assignedTeam} ». Remplis les informations ci-dessous pour confirmer votre participation.`;
      assignmentNote.classList.remove('msg');
    } catch (error) {
      assignmentNote.textContent = error.message;
      assignmentNote.classList.add('msg');
      teamButton.disabled = true;
    }
  } else {
    teamForm.hidden = true;
    participantForm.hidden = false;
  }

  function done(kind, data, result) {
    const d = $('#done'); d.hidden = false;
    if (kind === 'participants') {
      const team = result.assignment?.name || 'une équipe';
      const count = result.assignment?.memberCount || 1;
      const isLeader = result.assignment?.isLeader;
      d.innerHTML = `
        <h2>Préinscription validée !</h2>
        <p>Merci <strong>${esc(data.name)}</strong>, ta candidature a bien été enregistrée.</p>
        <div style="margin:20px 0;padding:18px 22px;background:rgba(31,211,138,.12);border:1px solid rgba(31,211,138,.35);border-radius:14px;">
          <div style="font:700 13px var(--fm);color:var(--sun);letter-spacing:.12em;text-transform:uppercase;">Affectation</div>
          <div style="font:700 22px var(--fh);color:#fff;margin:6px 0;">${esc(team)}</div>
          <div style="color:var(--mut);font-size:15px;">
            ${isLeader
              ? `👑 Tu es le <strong>chef d’équipe</strong> (${count}/5 membres). Dès que les 5 membres seront réunis, tu recevras par e-mail le lien pour finaliser l’inscription.`
              : `👥 Tu as rejoint l'équipe (${count}/5 membres). Dès qu'elle sera complète, le chef d'équipe recevra le lien de confirmation.`}
          </div>
        </div>
        <p style="font-size:15px;color:var(--mut);">${esc(result.message || '')}</p>
        <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
          <a class="btn gold" href="index.html">← Retour au site</a>
          <a class="btn ghost" href="index.html#deroule">Voir le déroulé</a>
        </div>
      `;
    } else {
      d.innerHTML = `
        <h2>Équipe inscrite avec succès !</h2>
        <p>L’inscription de <strong>${esc(data.name || 'ton équipe')}</strong> a bien été enregistrée par l’organisation.</p>
        <p style="margin-top:12px;color:var(--mut)">Rendez-vous du 13 au 15 novembre 2026 à l’Université Internationale Brice Clotaire Oligui Nguema du Cap, Libreville.</p>
        <div style="margin-top:24px;">
          <a class="btn gold" href="index.html">← Retour à l’accueil</a>
        </div>
      `;
    }
  }

  [participantForm, teamForm].forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!f.reportValidity()) return;
    const kind = f.dataset.kind;
    const box = kind === 'teams' ? $('#feedback-team') : $('#feedback');
    box.className = ''; box.textContent = '';
    const fd = new FormData(f), data = Object.fromEntries(fd.entries());
    data.mail = (data.mail || '').trim().toLowerCase();
    if (kind === 'teams') data.members = fd.getAll('member').map(s => s.trim()).filter(Boolean);
    const btn = $('button[type=submit]', f); btn.disabled = true; btn.textContent = 'Envoi en cours…';
    try {
      const result = await send(kind, data);
      f.hidden = true;
      done(kind, data, result);
      scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      box.className = 'msg'; box.textContent = err.message || 'Une erreur est survenue.';
      btn.disabled = false; btn.textContent = btn.dataset.label;
    }
  }));
}

function reveal() {
  const els = document.querySelectorAll('.rv'); if (!els.length) return;
  if (!('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
  els.forEach(e => io.observe(e));
}

layout(); countdown(); counters(); reveal(); forms();
})();
