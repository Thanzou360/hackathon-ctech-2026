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
  header.innerHTML = `<div class="bar"><a class="brand" href="index.html"><img src="assets/logo.svg" alt="" width="40" height="40"><span>Hackathon C-Tech<em>2026</em></span></a>
  <button class="burger" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="menu"><i></i><i></i></button>
  <nav id="menu" aria-label="Navigation principale"><a href="index.html#deroule">Déroulé</a><a href="index.html#faq">Questions</a><a href="jury.html"${cur('jury')}>Jury</a><a class="btn" href="inscription.html">Préinscription</a></nav></div>`;
  const contact = [C.CONTACT_EMAIL && `<a href="mailto:${esc(C.CONTACT_EMAIL)}">${esc(C.CONTACT_EMAIL)}</a>`, C.WHATSAPP && `<a href="https://wa.me/${esc(C.WHATSAPP)}">WhatsApp</a>`].filter(Boolean).join(' · ');
  footer.innerHTML = `<div class="wrap"><div class="ft">
    <div><strong>Hackathon C-Tech 2026</strong><p>Innover pour le Gabon<br>Du 13 au 15 novembre 2026<br>Université Internationale Brice Clotaire Oligui Nguema du Cap, Cap Estérias</p></div>
    <div><h4>Navigation</h4><ul><li><a href="inscription.html">Préinscription</a></li><li><a href="jury.html">Rejoindre le jury</a></li><li><a href="index.html#deroule">Déroulé</a></li><li><a href="index.html#faq">Questions fréquentes</a></li><li><a href="admin.html">Espace organisation</a></li></ul></div>
    <div><h4>Organisation</h4><ul><li>Club de Technologie C-Tech</li><li>En collaboration avec l’Institut Supérieur de Technologie (IST)</li>${contact ? `<li>${contact}</li>` : ''}</ul></div>
  </div><div class="copy"><span>© 2026 Hackathon C-Tech · Club C-Tech × IST</span><span>Cap Estérias, Gabon</span></div></div>`;
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

// Mode de fonctionnement :
//  - 'api'      : serveur Node local (server.js), pour le développement ;
//  - 'supabase' : base Supabase partagée (production sur GitHub Pages) ;
//  - 'demo'     : fichier ouvert localement sans base (file://) — rien n’est transmis ;
//  - 'off'      : site public sans base configurée — les formulaires sont désactivés.
const MODE = C.API_URL ? 'api'
  : (C.SUPABASE_URL && C.SUPABASE_ANON_KEY) ? 'supabase'
  : (location.protocol === 'file:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) ? 'demo' : 'off';
window.HK_MODE = MODE;
const OFF_MESSAGE = 'Les préinscriptions en ligne ne sont pas encore ouvertes. Contacte le Club C-Tech sur WhatsApp au 065 36 96 29.';

async function rpc(fn, args) {
  const url = `${C.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: C.SUPABASE_ANON_KEY, Authorization: `Bearer ${C.SUPABASE_ANON_KEY}` },
      body: JSON.stringify(args)
    });
  } catch {
    throw new Error('Impossible de joindre le service d’inscription. Vérifie ta connexion Internet et réessaie.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error((body && body.message) || `Le service d’inscription a refusé la demande (HTTP ${response.status}).`);
  if (body && body.ok === false) throw new Error(body.error || 'La demande a été refusée.');
  return body;
}
window.HK_RPC = rpc;

async function send(kind, data) {
  if (MODE === 'api') {
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

  if (MODE === 'supabase') {
    if (kind === 'participants') {
      const result = await rpc('hk_preinscrire', { p_name: data.name, p_fil: data.fil, p_mail: data.mail, p_tel: data.tel });
      const a = result.assignment || {};
      // Notification facultative à l’organisation (n’empêche jamais l’inscription)
      sendEmailJs({
        from_name: data.name, from_email: data.mail, filiere: data.fil,
        niveau: a.isLeader ? "Chef d'équipe" : 'Membre',
        interets: ['Hackathon C-Tech 2026', a.name],
        message: `Nouvelle préinscription Hackathon C-Tech 2026 :\n• Nom : ${data.name}\n• E-mail : ${data.mail}\n• Tél : ${data.tel}\n• Filière : ${data.fil}\n• Équipe : ${a.name} (${a.memberCount}/5)${a.teamComplete ? '\n→ Équipe complète : générer le lien du chef dans l’espace organisation.' : ''}`,
        to_email: C.CONTACT_EMAIL || 'ctech2798@gmail.com',
        sent_at: new Date().toLocaleString('fr-FR')
      }).catch(() => {});
      return result;
    }
    if (kind === 'teams') {
      return rpc('hk_finaliser', { p_token: data.invitationToken, p_fil: data.fil, p_tel: data.tel, p_idee: data.idee || '' });
    }
    return rpc('hk_jury_candidature', { p_name: data.name, p_org: data.org, p_mail: data.mail, p_tel: data.tel || '', p_exp: data.exp || '', p_days: data.days || [] });
  }

  if (MODE === 'off') throw new Error(OFF_MESSAGE);

  // Mode démonstration local : rien n’est transmis, aucune équipe n’est réellement attribuée.
  const k = 'hk-demo-' + kind, list = readStorage(k) || [];
  if (!Array.isArray(list)) throw new Error('Données de démonstration invalides.');
  if (list.some(x => x.mail === data.mail)) throw new Error('Cette adresse e-mail a déjà été utilisée (démonstration).');
  list.push({ ...data, created_at: new Date().toISOString() }); writeStorage(k, list);
  return { ok: true, demo: true, message: 'Mode démonstration : ces informations sont restées sur cet appareil et n’ont pas été transmises à l’organisation.' };
}

function showModeNotice() {
  const demo = $('#demo');
  if (!demo) return;
  if (MODE === 'demo') { demo.hidden = false; }
  if (MODE === 'off') {
    demo.hidden = false; demo.textContent = OFF_MESSAGE;
    document.querySelectorAll('form button[type=submit]').forEach(b => { b.disabled = true; });
  }
}

async function forms() {
  const participantForm = $('#participant-form');
  const teamForm = $('#team-form');
  if (!participantForm || !teamForm) {
    const juryForm = $('form[data-kind="jury"]');
    if (!juryForm) return;
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
        const confirmation = result.message || 'L’organisation a enregistré votre candidature.';
        doneBox.innerHTML = `
          <h2>${result.demo ? 'Démonstration' : 'Candidature reçue'}</h2>
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
      if (MODE === 'api') {
        const response = await fetch(`${C.API_URL.replace(/\/$/, '')}/api/team-invitations/${encodeURIComponent(invitationToken)}`);
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || 'Ce lien d’invitation est invalide ou expiré.');
        teamInfo = result.data;
      } else if (MODE === 'supabase') {
        teamInfo = await rpc('hk_invitation', { p_token: invitationToken });
      } else {
        throw new Error(MODE === 'off' ? OFF_MESSAGE : 'La finalisation d’équipe nécessite la base de données (indisponible en démonstration).');
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
    if (result.demo) {
      d.innerHTML = `<h2>Démonstration</h2><p>${esc(result.message)}</p>
        <div style="margin-top:24px"><a class="btn ghost" href="index.html">← Retour au site</a></div>`;
      return;
    }
    if (kind === 'participants') {
      const a = result.assignment || {};
      const team = a.name || 'une équipe';
      const count = a.memberCount || 1;
      d.innerHTML = `
        <h2>Préinscription enregistrée</h2>
        <p>Merci <strong>${esc(data.name)}</strong>, ta préinscription a bien été enregistrée par l’organisation.</p>
        <div style="margin:20px 0;padding:18px 22px;background:rgba(31,211,138,.12);border:1px solid rgba(31,211,138,.35);border-radius:14px;">
          <div style="font:700 13px var(--fm);color:var(--sun);letter-spacing:.12em;text-transform:uppercase;">Affectation</div>
          <div style="font:700 22px var(--fh);color:#fff;margin:6px 0;">${esc(team)}</div>
          <div style="color:var(--mut);font-size:15px;">
            ${a.isLeader
              ? `👑 Tu es le <strong>chef d’équipe</strong> (${count}/5 membres). Quand ton équipe sera complète, l’organisation t’enverra un lien personnel pour finaliser l’inscription de l’équipe.`
              : `👥 Tu as rejoint l’équipe (${count}/5 membres). Quand elle sera complète, le chef d’équipe recevra de l’organisation le lien pour la finaliser.`}
          </div>
        </div>
        <p style="font-size:15px;color:var(--mut);">Ta participation ne sera définitive qu’après la finalisation de l’équipe, le règlement de la cotisation de 15 000 FCFA et la validation par l’organisation.</p>
        <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
          <a class="btn gold" href="index.html">← Retour au site</a>
          <a class="btn ghost" href="index.html#deroule">Voir le déroulé</a>
        </div>
      `;
    } else {
      d.innerHTML = `
        <h2>Dossier d’équipe transmis</h2>
        <p>Le dossier de <strong>${esc(data.name || 'ton équipe')}</strong> a bien été envoyé à l’organisation.</p>
        <p style="margin-top:12px;color:var(--mut)">L’organisation va le vérifier puis confirmer votre inscription. Rendez-vous du 13 au 15 novembre 2026 au Cap Estérias.</p>
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

layout(); countdown(); counters(); reveal(); showModeNotice(); forms();
})();
