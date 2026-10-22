import { writable } from "svelte/store";

export type Lang = "en" | "es" | "fr" | "de" | "it" | "pt" | "nl";

export const LANGUAGES: { code: Lang; region: string; label: string }[] = [
  { code: "en", region: "GB", label: "English" },
  { code: "de", region: "DE", label: "Deutsch" },
  { code: "fr", region: "FR", label: "Français" },
  { code: "es", region: "ES", label: "Español" },
  { code: "it", region: "IT", label: "Italiano" },
  { code: "pt", region: "PT", label: "Português" },
  { code: "nl", region: "NL", label: "Nederlands" },
];

const STORAGE_KEY = "sweepr_lang";

function loadInitialLang(): Lang {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY) as Lang | null;
    if (saved && LANGUAGES.some((l) => l.code === saved)) {
      return saved;
    }
  }
  return "en";
}

export const lang = writable<Lang>(loadInitialLang());

export function setLang(next: Lang) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, next);
  }
  lang.set(next);
}

export function getLang(): Lang {
  return loadInitialLang();
}

export const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    "nav.smartScan": "Smart Scan",
    "nav.battery": "Battery Care",
    "nav.accountOnly": "Account",
    "nav.group.speed": "Speed",
    "nav.group.storage": "Storage",
    "nav.group.protect": "Protect",
    "nav.cleaner": "Home & Clean",
    "nav.speed": "Speed Up",
    "nav.space": "Space & Cloud",
    "nav.apps": "Apps",
    "nav.privacy": "Privacy & Safety",
    "nav.schedule": "Auto-Clean",
    "nav.account": "Account & Auto-Clean",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "tier.free": "Free Plan",
    "tier.pro": "Pro",
    "tier.activated": "Active",
    "action.scan": "Scan My PC",
    "action.clean": "Clean Now",
    "action.activate": "Upgrade to Pro",
    "action.cancel": "Cancel",
    "action.restore": "Restore",
    "header.welcome": "Welcome back!",
    "header.account": "Account",
  },
  es: {
    "nav.cleaner": "Inicio y Limpieza",
    "nav.speed": "Acelerar",
    "nav.space": "Espacio y Nube",
    "nav.apps": "Programas",
    "nav.privacy": "Privacidad",
    "nav.schedule": "Auto-Limpieza",
    "nav.account": "Cuenta y Auto-Limpieza",
    "theme.light": "Claro",
    "theme.dark": "Oscuro",
    "tier.free": "Gratis",
    "tier.pro": "Pro",
    "tier.activated": "Activo",
    "action.scan": "Analizar mi PC",
    "action.clean": "Limpiar",
    "action.activate": "Activar SWEEPR",
    "action.cancel": "Cancelar",
    "action.restore": "Restaurar",
    "header.welcome": "¡Bienvenido de nuevo!",
    "header.account": "Cuenta",
  },
  fr: {
    "nav.cleaner": "Accueil & Nettoyage",
    "nav.speed": "Accélérer",
    "nav.space": "Espace & Cloud",
    "nav.apps": "Applications",
    "nav.privacy": "Confidentialité",
    "nav.schedule": "Nettoyage Auto",
    "nav.account": "Compte & Nettoyage Auto",
    "theme.light": "Clair",
    "theme.dark": "Sombre",
    "tier.free": "Gratuit",
    "tier.pro": "Pro",
    "tier.activated": "Activé",
    "action.scan": "Analyser mon PC",
    "action.clean": "Nettoyer",
    "action.activate": "Activer SWEEPR",
    "action.cancel": "Annuler",
    "action.restore": "Restaurer",
    "header.welcome": "Bon retour !",
    "header.account": "Compte",
  },
  de: {
    "nav.cleaner": "Start & Bereinigen",
    "nav.speed": "Beschleunigen",
    "nav.space": "Speicher & Cloud",
    "nav.apps": "Programme",
    "nav.privacy": "Datenschutz",
    "nav.schedule": "Auto-Reinigung",
    "nav.account": "Konto & Auto-Reinigung",
    "theme.light": "Hell",
    "theme.dark": "Dunkel",
    "tier.free": "Gratis",
    "tier.pro": "Pro",
    "tier.activated": "Aktiviert",
    "action.scan": "PC jetzt prüfen",
    "action.clean": "Bereinigen",
    "action.activate": "SWEEPR aktivieren",
    "action.cancel": "Abbrechen",
    "action.restore": "Wiederherstellen",
    "header.welcome": "Willkommen zurück!",
    "header.account": "Konto",
  },
  it: {
    "nav.cleaner": "Home e Pulizia",
    "nav.speed": "Velocizza",
    "nav.space": "Spazio e Cloud",
    "nav.apps": "Programmi",
    "nav.privacy": "Privacy e Sicurezza",
    "nav.schedule": "Pulizia Auto",
    "nav.account": "Account e Pulizia Auto",
    "theme.light": "Chiaro",
    "theme.dark": "Scuro",
    "tier.free": "Gratis",
    "tier.pro": "Pro",
    "tier.activated": "Attivo",
    "action.scan": "Analizza il PC",
    "action.clean": "Pulisci",
    "action.activate": "Attiva SWEEPR",
    "action.cancel": "Annulla",
    "action.restore": "Ripristina",
    "header.welcome": "Bentornato!",
    "header.account": "Account",
  },
  pt: {
    "nav.cleaner": "Início e Limpeza",
    "nav.speed": "Acelerar",
    "nav.space": "Espaço e Nuvem",
    "nav.apps": "Programas",
    "nav.privacy": "Privacidade",
    "nav.schedule": "Limpeza Auto",
    "nav.account": "Conta e Limpeza Auto",
    "theme.light": "Claro",
    "theme.dark": "Escuro",
    "tier.free": "Grátis",
    "tier.pro": "Pro",
    "tier.activated": "Ativo",
    "action.scan": "Verificar o PC",
    "action.clean": "Limpar",
    "action.activate": "Ativar SWEEPR",
    "action.cancel": "Cancelar",
    "action.restore": "Restaurar",
    "header.welcome": "Bem-vindo de volta!",
    "header.account": "Conta",
  },
  nl: {
    "nav.cleaner": "Start & Opschonen",
    "nav.speed": "Versnellen",
    "nav.space": "Ruimte & Cloud",
    "nav.apps": "Programma's",
    "nav.privacy": "Privacy & Veiligheid",
    "nav.schedule": "Auto-Opschonen",
    "nav.account": "Account & Auto-Opschonen",
    "theme.light": "Licht",
    "theme.dark": "Donker",
    "tier.free": "Gratis",
    "tier.pro": "Pro",
    "tier.activated": "Actief",
    "action.scan": "Mijn PC scannen",
    "action.clean": "Opschonen",
    "action.activate": "SWEEPR activeren",
    "action.cancel": "Annuleren",
    "action.restore": "Herstellen",
    "header.welcome": "Welkom terug!",
    "header.account": "Account",
  },
};

export function t(key: string, currentLang: Lang = "en"): string {
  return TRANSLATIONS[currentLang]?.[key] ?? TRANSLATIONS.en[key] ?? key;
}
