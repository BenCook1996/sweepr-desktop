import { writable } from "svelte/store";

export type Lang = "en" | "es" | "fr" | "de" | "it" | "pt" | "nl";

export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "nl", label: "Nederlands" },
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
    "nav.cleaner": "Dashboard",
    "nav.optimization": "Optimization",
    "nav.utilities": "Utilities & Privacy",
    "nav.account": "Account",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "tier.free": "Free Tier",
    "tier.pro": "Pro",
    "tier.activated": "Activated",
    "action.scan": "Quick Scan Now",
    "action.clean": "Clean",
    "action.activate": "Activate",
    "action.cancel": "Cancel",
    "action.restore": "Restore",
    "header.welcome": "Welcome back!",
    "header.account": "Account",
    "header.duplicates": "Duplicate & Large File Finder",
    "header.privacy": "Privacy & Breach Check",
  },
  es: {
    "nav.cleaner": "Panel",
    "nav.optimization": "Optimización",
    "nav.utilities": "Utilidades y Privacidad",
    "nav.account": "Cuenta",
    "theme.light": "Claro",
    "theme.dark": "Oscuro",
    "tier.free": "Plan Gratis",
    "tier.pro": "Pro",
    "tier.activated": "Activado",
    "action.scan": "Escaneo Rápido",
    "action.clean": "Limpiar",
    "action.activate": "Activar",
    "action.cancel": "Cancelar",
    "action.restore": "Restaurar",
    "header.welcome": "¡Bienvenido de nuevo!",
    "header.account": "Cuenta",
    "header.duplicates": "Buscador de Duplicados y Archivos Grandes",
    "header.privacy": "Privacidad y Filtraciones",
  },
  fr: {
    "nav.cleaner": "Tableau de bord",
    "nav.optimization": "Optimisation",
    "nav.utilities": "Utilitaires et Confidentialité",
    "nav.account": "Compte",
    "theme.light": "Clair",
    "theme.dark": "Sombre",
    "tier.free": "Version Gratuite",
    "tier.pro": "Pro",
    "tier.activated": "Activé",
    "action.scan": "Analyse Rapide",
    "action.clean": "Nettoyer",
    "action.activate": "Activer",
    "action.cancel": "Annuler",
    "action.restore": "Restaurer",
    "header.welcome": "Bon retour !",
    "header.account": "Compte",
    "header.duplicates": "Doublons et Fichiers Volumineux",
    "header.privacy": "Confidentialité et Fuites",
  },
  de: {
    "nav.cleaner": "Übersicht",
    "nav.optimization": "Optimierung",
    "nav.utilities": "Extras & Datenschutz",
    "nav.account": "Konto",
    "theme.light": "Hell",
    "theme.dark": "Dunkel",
    "tier.free": "Kostenlos",
    "tier.pro": "Pro",
    "tier.activated": "Aktiviert",
    "action.scan": "Schnellscan starten",
    "action.clean": "Bereinigen",
    "action.activate": "Aktivieren",
    "action.cancel": "Abbrechen",
    "action.restore": "Wiederherstellen",
    "header.welcome": "Willkommen zurück!",
    "header.account": "Konto",
    "header.duplicates": "Duplikate & Große Dateien",
    "header.privacy": "Datenschutz & Datenlecks",
  },
  it: {
    "nav.cleaner": "Panoramica",
    "nav.optimization": "Ottimizzazione",
    "nav.utilities": "Utilità e Privacy",
    "nav.account": "Account",
    "theme.light": "Chiaro",
    "theme.dark": "Scuro",
    "tier.free": "Piano Gratuito",
    "tier.pro": "Pro",
    "tier.activated": "Attivato",
    "action.scan": "Scansione Rapida",
    "action.clean": "Pulisci",
    "action.activate": "Attiva",
    "action.cancel": "Annulla",
    "action.restore": "Ripristina",
    "header.welcome": "Bentornato!",
    "header.account": "Account",
    "header.duplicates": "Duplicati e File Grandi",
    "header.privacy": "Privacy e Violazioni",
  },
  pt: {
    "nav.cleaner": "Painel",
    "nav.optimization": "Otimização",
    "nav.utilities": "Utilitários e Privacidade",
    "nav.account": "Conta",
    "theme.light": "Claro",
    "theme.dark": "Escuro",
    "tier.free": "Plano Gratuito",
    "tier.pro": "Pro",
    "tier.activated": "Ativado",
    "action.scan": "Verificação Rápida",
    "action.clean": "Limpar",
    "action.activate": "Ativar",
    "action.cancel": "Cancelar",
    "action.restore": "Restaurar",
    "header.welcome": "Bem-vindo de volta!",
    "header.account": "Conta",
    "header.duplicates": "Duplicados e Arquivos Grandes",
    "header.privacy": "Privacidade e Vazamentos",
  },
  nl: {
    "nav.cleaner": "Dashboard",
    "nav.optimization": "Optimalisatie",
    "nav.utilities": "Hulpprogramma's & Privacy",
    "nav.account": "Account",
    "theme.light": "Licht",
    "theme.dark": "Donker",
    "tier.free": "Gratis",
    "tier.pro": "Pro",
    "tier.activated": "Geactiveerd",
    "action.scan": "Snelle Scan",
    "action.clean": "Opschonen",
    "action.activate": "Activeren",
    "action.cancel": "Annuleren",
    "action.restore": "Herstellen",
    "header.welcome": "Welkom terug!",
    "header.account": "Account",
    "header.duplicates": "Duplicaten & Grote Bestanden",
    "header.privacy": "Privacy & Datalekken",
  },
};

export function t(key: string, currentLang: Lang = "en"): string {
  return TRANSLATIONS[currentLang]?.[key] ?? TRANSLATIONS.en[key] ?? key;
}
