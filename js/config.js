// Détection automatique de l'URL de l'API :
// 1. window.HK_API_URL si spécifié manuellement.
// 2. Si on est en local (localhost / 127.0.0.1) sur un port différent de 3000 (ex. Live Server port 5500),
//    on cible automatiquement le backend local sur le port 3000.
// 3. Si protocole file://, chaîne vide pour activer le mode démo hors-ligne.
// 4. Sinon, même origine que la page (cas standard où server.js sert le site).
function resolveApiUrl() {
  if (typeof window !== 'undefined' && window.HK_API_URL) return window.HK_API_URL;
  if (typeof window === 'undefined') return '';
  if (window.location.protocol === 'file:') return '';
  // Sur GitHub Pages (*.github.io), aucun backend Express n'est hébergé localement par défaut
  if (window.location.hostname.endsWith('github.io')) return '';
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return window.location.port === '3000' ? window.location.origin : 'http://' + window.location.hostname + ':3000';
  }
  return window.location.origin;
}

const HK_API_URL = resolveApiUrl();

window.HK_CONFIG = {
  EVENT_DATE: "2026-11-13T08:00:00+01:00", // début de l'événement (heure du Gabon)
  CONTACT_EMAIL: "ctech2798@gmail.com",
  WHATSAPP: "241065369629", // 065 36 96 29 (Club C-Tech)
  API_URL: HK_API_URL,

  // Supabase (partagé avec le site C-Tech)
  SUPABASE_URL: "https://dkgxjgjioqzwfncsntln.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrZ3hqZ2ppb3F6d2ZuY3NudGxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMTEwMDcsImV4cCI6MjEwMjc4NzAwN30.N-FjvHJtDMEWlbKQ4StJ9zic0QRwHWshqcWrCLvM68w",

  // EmailJS (partagé avec le site C-Tech)
  EMAILJS_SERVICE_ID: "service_7p6hu8i",
  EMAILJS_TEMPLATE_ID: "template_p9uaz9f",
  EMAILJS_PUBLIC_KEY: "swccw7PktiWD4AcAL"
};
