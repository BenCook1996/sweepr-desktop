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
    "nav.cleaner": "Dashboard",
    "nav.schedule": "Schedule",
    "nav.optimization": "Optimization",
    "nav.account": "Account & Settings",
    "theme.light": "Light",
    "theme.dark": "Dark",
    "tier.free": "Free",
    "tier.pro": "Pro",
    "tier.activated": "Activated",
    "action.scan": "Quick Scan Now",
    "action.clean": "Clean",
    "action.activate": "Activate SWEEPR",
    "action.cancel": "Cancel",
    "action.restore": "Restore",
    "header.welcome": "Welcome back!",
    "header.account": "Account",
  },
  es: {
    "nav.cleaner": "Panel",
    "nav.schedule": "Programación",
    "nav.optimization": "Optimización",
    "nav.account": "Cuenta y Ajustes",
    "theme.light": "Claro",
    "theme.dark": "Oscuro",
    "tier.free": "Gratis",
    "tier.pro": "Pro",
    "tier.activated": "Activado",
    "action.scan": "Escaneo Rápido",
    "action.clean": "Limpiar",
    "action.activate": "Activar SWEEPR",
    "action.cancel": "Cancelar",
    "action.restore": "Restaurar",
    "header.welcome": "¡Bienvenido de nuevo!",
    "header.account": "Cuenta",
  },
  fr: {
    "nav.cleaner": "Tableau de bord",
    "nav.schedule": "Planification",
    "nav.optimization": "Optimisation",
    "nav.account": "Compte et Paramètres",
    "theme.light": "Clair",
    "theme.dark": "Sombre",
    "tier.free": "Gratuit",
    "tier.pro": "Pro",
    "tier.activated": "Activé",
    "action.scan": "Analyse Rapide",
    "action.clean": "Nettoyer",
    "action.activate": "Activer SWEEPR",
    "action.cancel": "Annuler",
    "action.restore": "Restaurer",
    "header.welcome": "Bon retour !",
    "header.account": "Compte",
  },
  de: {
    "nav.cleaner": "Übersicht",
    "nav.schedule": "Zeitplan",
    "nav.optimization": "Optimierung",
    "nav.account": "Konto & Einstellungen",
    "theme.light": "Hell",
    "theme.dark": "Dunkel",
    "tier.free": "Gratis",
    "tier.pro": "Pro",
    "tier.activated": "Aktiviert",
    "action.scan": "Schnellscan starten",
    "action.clean": "Bereinigen",
    "action.activate": "SWEEPR aktivieren",
    "action.cancel": "Abbrechen",
    "action.restore": "Wiederherstellen",
    "header.welcome": "Willkommen zurück!",
    "header.account": "Konto",
  },
  it: {
    "nav.cleaner": "Panoramica",
    "nav.schedule": "Pianificazione",
    "nav.optimization": "Ottimizzazione",
    "nav.account": "Account e Impostazioni",
    "theme.light": "Chiaro",
    "theme.dark": "Scuro",
    "tier.free": "Gratis",
    "tier.pro": "Pro",
    "tier.activated": "Attivato",
    "action.scan": "Scansione Rapida",
    "action.clean": "Pulisci",
    "action.activate": "Attiva SWEEPR",
    "action.cancel": "Annulla",
    "action.restore": "Ripristina",
    "header.welcome": "Bentornato!",
    "header.account": "Account",
  },
  pt: {
    "nav.cleaner": "Painel",
    "nav.schedule": "Agendamento",
    "nav.optimization": "Otimização",
    "nav.account": "Conta e Definições",
    "theme.light": "Claro",
    "theme.dark": "Escuro",
    "tier.free": "Grátis",
    "tier.pro": "Pro",
    "tier.activated": "Ativado",
    "action.scan": "Verificação Rápida",
    "action.clean": "Limpar",
    "action.activate": "Ativar SWEEPR",
    "action.cancel": "Cancelar",
    "action.restore": "Restaurar",
    "header.welcome": "Bem-vindo de volta!",
    "header.account": "Conta",
  },
  nl: {
    "nav.cleaner": "Dashboard",
    "nav.schedule": "Schema",
    "nav.optimization": "Optimalisatie",
    "nav.account": "Account & Instellingen",
    "theme.light": "Licht",
    "theme.dark": "Donker",
    "tier.free": "Gratis",
    "tier.pro": "Pro",
    "tier.activated": "Geactiveerd",
    "action.scan": "Snelle Scan",
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
