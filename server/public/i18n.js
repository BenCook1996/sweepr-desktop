/**
 * Sweepr Cleaner Dynamic Multi-Language Internationalization (i18n) Engine
 * Provides client-side instant dictionary translation + deep DOM Google Translate fallback.
 */

const LANGS = {
  en: { name: 'English', flag: '🇬🇧', code: 'EN' },
  de: { name: 'Deutsch', flag: '🇩🇪', code: 'DE' },
  fr: { name: 'Français', flag: '🇫🇷', code: 'FR' },
  es: { name: 'Español', flag: '🇪🇸', code: 'ES' },
  it: { name: 'Italiano', flag: '🇮🇹', code: 'IT' },
  pt: { name: 'Português', flag: '🇵🇹', code: 'PT' },
  nl: { name: 'Nederlands', flag: '🇳🇱', code: 'NL' },
  ja: { name: '日本語', flag: '🇯🇵', code: 'JA' }
};

const I18N_DICTIONARY = {
  de: {
    "Features": "Funktionen",
    "Pricing": "Preise",
    "Compare & Guides": "Vergleich & Anleitungen",
    "Login": "Anmelden",
    "Get Sweepr Cleaner": "SWEEPR Cleaner holen",
    "Get SWEEPR Cleaner": "SWEEPR Cleaner holen",
    "Get Sweepr": "SWEEPR holen",
    "Get SWEEPR": "SWEEPR holen",
    "Download SWEEPR Cleaner": "SWEEPR Cleaner herunterladen",
    "Download Free Scan": "Kostenlosen Scan herunterladen",
    "Revive your PC.": "Erwecken Sie Ihren PC zu neuem Leben.",
    "The lightweight, native Rust PC cleaner that erases gigabytes of cache, uninstalls stubborn bloat, and restores lightning speed. Zero telemetry. No background daemons.": "Der schlanke, native Rust-PC-Reiniger, der Gigabytes an Cache löscht, hartnäckigen Datenmüll deinstalliert und blitzschnelle Geschwindigkeit wiederherstellt. Keine Telemetrie. Keine Hintergrunddienste.",
    "Special Introductory Plan": "Spezielles Einführungsangebot",
    "Get Sweepr Cleaner Pro": "SWEEPR Cleaner Pro holen",
    "Get SWEEPR Cleaner Pro": "SWEEPR Cleaner Pro holen",
    "Includes 3 Desktop PCs + 2 Mobile Cleaner Apps": "Beinhaltet 3 Desktop-PCs + 2 mobile Reinigungs-Apps",
    "Deep System Cache Clean & Duplicate Shredder": "Tiefe System-Cache-Reinigung & Duplikat-Schredder",
    "100% Risk-Free 30-Day Money-Back Guarantee": "100% risikofreie 14-Tage Geld-zurück-Garantie",
    "100% Risk-Free 14-Day Money-Back Guarantee": "100% risikofreie 14-Tage Geld-zurück-Garantie",
    "30-Day Money-Back Guarantee": "14-Tage Geld-zurück-Garantie",
    "14-Day Money-Back Guarantee": "14-Tage Geld-zurück-Garantie",
    "Cancel Anytime in 1-Click": "Jederzeit mit 1 Klick kündbar",
    "Cancel Anytime": "Jederzeit kündbar",
    "CLAIM DISCOUNT": "RABATT SICHERN",
    "CLAIM 1ST MONTH FOR £1.99": "1. MONAT FÜR 1,99 £ SICHERN",
    "Claim Discount": "Rabatt sichern",
    "1st Month Only": "Nur 1. Monat",
    "Renews at": "Verlängert sich für",
    "Sweepr vs CCleaner": "SWEEPR Cleaner im Vergleich zu CCleaner",
    "SWEEPR Cleaner vs CCleaner": "SWEEPR Cleaner im Vergleich zu CCleaner",
    "CCleaner Alternatives": "CCleaner-Alternativen",
    "Storage & Cache Directory": "Speicher- & Cache-Verzeichnis",
    "Directory": "Verzeichnis",
    "Comparison": "Vergleich",
    "2026 Guide": "Leitfaden 2026",
    "40+ Guides": "40+ Anleitungen",
    "256-Bit SSL": "256-Bit SSL",
    "Instant Delivery": "Sofortige Lieferung",
    "30-Day Refund": "14-Tage Rückerstattung",
    "14-Day Refund": "14-Tage Rückerstattung",
    "SPECIAL INTRODUCTORY OFFER": "SPEZIELLES EINFÜHRUNGSANGEBOT",
    "Order Summary": "Bestellübersicht",
    "DeepClean Engine": "DeepClean-Engine",
    "RAM & Startup Booster": "RAM- & Autostart-Booster",
    "Smart Uninstaller": "Intelligenter Deinstallierer",
    "Duplicate Finder": "Duplikat-Finder",
    "Military-Grade Shredder": "Militärischer Schredder",
    "Quarantine Rollback": "Quarantäne-Wiederherstellung",
    "Email Address": "E-Mail-Adresse",
    "Address": "Adresse",
    "Post Code": "Postleitzahl",
    "Card Number": "Kartennummer",
    "Expiration": "Ablaufdatum",
    "Continue": "Weiter"
  },
  fr: {
    "Features": "Fonctionnalités",
    "Pricing": "Tarifs",
    "Compare & Guides": "Comparatifs & Guides",
    "Login": "Connexion",
    "Get Sweepr Cleaner": "Obtenir SWEEPR Cleaner",
    "Get SWEEPR Cleaner": "Obtenir SWEEPR Cleaner",
    "Get Sweepr": "Obtenir SWEEPR",
    "Get SWEEPR": "Obtenir SWEEPR",
    "Download SWEEPR Cleaner": "Télécharger SWEEPR Cleaner",
    "Download Free Scan": "Télécharger le scan gratuit",
    "Revive your PC.": "Donnez un second souffle à votre PC.",
    "The lightweight, native Rust PC cleaner that erases gigabytes of cache, uninstalls stubborn bloat, and restores lightning speed. Zero telemetry. No background daemons.": "Le nettoyeur de PC ultra-léger en Rust natif qui efface des gigaoctets de cache, désinstalle les logiciels indésirables et restaure une vitesse fulgurante. Zéro télémétrie. Aucun service en arrière-plan.",
    "Special Introductory Plan": "Offre Spéciale de Lancement",
    "Get Sweepr Cleaner Pro": "Obtenir SWEEPR Cleaner Pro",
    "Get SWEEPR Cleaner Pro": "Obtenir SWEEPR Cleaner Pro",
    "Includes 3 Desktop PCs + 2 Mobile Cleaner Apps": "Inclut 3 PC de bureau + 2 applications mobiles",
    "Deep System Cache Clean & Duplicate Shredder": "Nettoyage approfondi du cache & destructeur de doublons",
    "100% Risk-Free 30-Day Money-Back Guarantee": "Garantie 100% satisfait ou remboursé 14 jours",
    "100% Risk-Free 14-Day Money-Back Guarantee": "Garantie 100% satisfait ou remboursé 14 jours",
    "30-Day Money-Back Guarantee": "Garantie satisfait ou remboursé 14 jours",
    "14-Day Money-Back Guarantee": "Garantie satisfait ou remboursé 14 jours",
    "Cancel Anytime in 1-Click": "Annulation en 1 clic à tout moment",
    "Cancel Anytime": "Annuler à tout moment",
    "CLAIM DISCOUNT": "RÉCLAMER LA RÉDUCTION",
    "CLAIM 1ST MONTH FOR £1.99": "RÉCLAMER LE 1ER MOIS À 1,99 £",
    "Claim Discount": "Réclamer la réduction",
    "1st Month Only": "1er mois seulement",
    "Renews at": "Renouvellement à",
    "Sweepr vs CCleaner": "SWEEPR Cleaner contre CCleaner",
    "SWEEPR Cleaner vs CCleaner": "SWEEPR Cleaner contre CCleaner",
    "CCleaner Alternatives": "Alternatives à CCleaner",
    "Storage & Cache Directory": "Répertoire de stockage & cache",
    "Directory": "Répertoire",
    "Comparison": "Comparatif",
    "2026 Guide": "Guide 2026",
    "40+ Guides": "Plus de 40 guides",
    "256-Bit SSL": "SSL 256 bits",
    "Instant Delivery": "Livraison instantanée",
    "30-Day Refund": "Remboursement 14 jours",
    "14-Day Refund": "Remboursement 14 jours",
    "SPECIAL INTRODUCTORY OFFER": "OFFRE SPÉCIALE D'INTRODUCTION",
    "Order Summary": "Récapitulatif de la commande",
    "DeepClean Engine": "Moteur DeepClean",
    "RAM & Startup Booster": "Optimiseur RAM & démarrage",
    "Smart Uninstaller": "Désinstallateur intelligent",
    "Duplicate Finder": "Recherche de doublons",
    "Military-Grade Shredder": "Broyeur de fichiers sécurisé",
    "Quarantine Rollback": "Restauration depuis la quarantaine",
    "Email Address": "Adresse e-mail",
    "Address": "Adresse",
    "Post Code": "Code postal",
    "Card Number": "Numéro de carte",
    "Expiration": "Date d'expiration",
    "Continue": "Continuer"
  },
  es: {
    "Features": "Características",
    "Pricing": "Precios",
    "Compare & Guides": "Comparativas y Guías",
    "Login": "Iniciar sesión",
    "Get Sweepr Cleaner": "Obtener SWEEPR Cleaner",
    "Get SWEEPR Cleaner": "Obtener SWEEPR Cleaner",
    "Get Sweepr": "Obtener SWEEPR",
    "Get SWEEPR": "Obtener SWEEPR",
    "Download SWEEPR Cleaner": "Descargar SWEEPR Cleaner",
    "Download Free Scan": "Descargar análisis gratis",
    "Revive your PC.": "Revive tu PC.",
    "The lightweight, native Rust PC cleaner that erases gigabytes of cache, uninstalls stubborn bloat, and restores lightning speed. Zero telemetry. No background daemons.": "El limpiador de PC ultra-ligero desarrollado en Rust nativo que borra gigabytes de caché, desinstala programas rebeldes y devuelve una velocidad ultrarrápida. Cero telemetría. Sin procesos en segundo plano.",
    "Special Introductory Plan": "Plan Especial de Lanzamiento",
    "Get Sweepr Cleaner Pro": "Obtener SWEEPR Cleaner Pro",
    "Get SWEEPR Cleaner Pro": "Obtener SWEEPR Cleaner Pro",
    "Includes 3 Desktop PCs + 2 Mobile Cleaner Apps": "Incluye 3 ordenadores de escritorio + 2 apps móviles",
    "Deep System Cache Clean & Duplicate Shredder": "Limpieza profunda de caché del sistema y triturador de duplicados",
    "100% Risk-Free 30-Day Money-Back Guarantee": "Garantía de reembolso de 14 días sin riesgo",
    "100% Risk-Free 14-Day Money-Back Guarantee": "Garantía de reembolso de 14 días sin riesgo",
    "30-Day Money-Back Guarantee": "Garantía de reembolso de 14 días",
    "14-Day Money-Back Guarantee": "Garantía de reembolso de 14 días",
    "Cancel Anytime in 1-Click": "Cancela en cualquier momento con 1 clic",
    "Cancel Anytime": "Cancela en cualquier momento",
    "CLAIM DISCOUNT": "RECLAMAR DESCUENTO",
    "CLAIM 1ST MONTH FOR £1.99": "RECLAMAR 1ER MES POR 1,99 £",
    "Claim Discount": "Reclamar descuento",
    "1st Month Only": "Solo el 1er mes",
    "Renews at": "Se renueva a",
    "Sweepr vs CCleaner": "SWEEPR Cleaner frente a CCleaner",
    "SWEEPR Cleaner vs CCleaner": "SWEEPR Cleaner frente a CCleaner",
    "CCleaner Alternatives": "Alternativas a CCleaner",
    "Storage & Cache Directory": "Directorio de almacenamiento y caché",
    "Directory": "Directorio",
    "Comparison": "Comparativa",
    "2026 Guide": "Guía 2026",
    "40+ Guides": "Más de 40 guías",
    "256-Bit SSL": "SSL de 256 bits",
    "Instant Delivery": "Entrega inmediata",
    "30-Day Refund": "Reembolso en 14 días",
    "14-Day Refund": "Reembolso en 14 días",
    "SPECIAL INTRODUCTORY OFFER": "OFERTA ESPECIAL DE INTRODUCCIÓN",
    "Order Summary": "Resumen del pedido",
    "DeepClean Engine": "Motor DeepClean",
    "RAM & Startup Booster": "Acelerador de RAM e inicio",
    "Smart Uninstaller": "Desinstalador inteligente",
    "Duplicate Finder": "Buscador de duplicados",
    "Military-Grade Shredder": "Destructor de archivos militar",
    "Quarantine Rollback": "Recuperación desde cuarentena",
    "Email Address": "Correo electrónico",
    "Address": "Dirección",
    "Post Code": "Código postal",
    "Card Number": "Número de tarjeta",
    "Expiration": "Fecha de caducidad",
    "Continue": "Continuar"
  },
  it: {
    "Features": "Funzionalità",
    "Pricing": "Prezzi",
    "Compare & Guides": "Confronti e Guide",
    "Login": "Accedi",
    "Get Sweepr Cleaner": "Ottieni SWEEPR Cleaner",
    "Get SWEEPR Cleaner": "Ottieni SWEEPR Cleaner",
    "Get Sweepr": "Ottieni SWEEPR",
    "Get SWEEPR": "Ottieni SWEEPR",
    "Download SWEEPR Cleaner": "Scarica SWEEPR Cleaner",
    "Download Free Scan": "Scarica scansione gratuita",
    "Revive your PC.": "Fai rinascere il tuo PC.",
    "Special Introductory Plan": "Piano Speciale di Lancio",
    "Get Sweepr Cleaner Pro": "Ottieni SWEEPR Cleaner Pro",
    "Get SWEEPR Cleaner Pro": "Ottieni SWEEPR Cleaner Pro",
    "Includes 3 Desktop PCs + 2 Mobile Cleaner Apps": "Include 3 PC Desktop + 2 App di pulizia mobile",
    "Deep System Cache Clean & Duplicate Shredder": "Pulizia profonda cache di sistema e distruttore duplicati",
    "100% Risk-Free 30-Day Money-Back Guarantee": "Garanzia 100% soddisfatti o rimborsati di 14 giorni",
    "100% Risk-Free 14-Day Money-Back Guarantee": "Garanzia 100% soddisfatti o rimborsati di 14 giorni",
    "30-Day Money-Back Guarantee": "Garanzia di rimborso a 14 giorni",
    "14-Day Money-Back Guarantee": "Garanzia di rimborso a 14 giorni",
    "Cancel Anytime in 1-Click": "Annulla in qualsiasi momento con 1 clic",
    "CLAIM DISCOUNT": "RICHIEDI LO SCONTO",
    "Claim Discount": "Richiedi lo sconto",
    "1st Month Only": "Solo 1° Mese",
    "Renews at": "Si rinnova a",
    "Sweepr vs CCleaner": "SWEEPR Cleaner vs CCleaner",
    "SWEEPR Cleaner vs CCleaner": "SWEEPR Cleaner vs CCleaner",
    "CCleaner Alternatives": "Alternative a CCleaner",
    "Storage & Cache Directory": "Directory memoria e cache",
    "Directory": "Directory",
    "Comparison": "Confronto",
    "2026 Guide": "Guida 2026",
    "40+ Guides": "40+ Guide",
    "256-Bit SSL": "SSL a 256-Bit",
    "Instant Delivery": "Consegna immediata",
    "30-Day Refund": "Rimborso 14 giorni",
    "14-Day Refund": "Rimborso 14 giorni",
    "SPECIAL INTRODUCTORY OFFER": "OFFERTA SPECIALE DI BENVENUTO",
    "Email Address": "Indirizzo Email",
    "Continue": "Continua"
  },
  pt: {
    "Features": "Recursos",
    "Pricing": "Preços",
    "Compare & Guides": "Comparações e Guias",
    "Login": "Entrar",
    "Get Sweepr Cleaner": "Obter o SWEEPR Cleaner",
    "Get SWEEPR Cleaner": "Obter o SWEEPR Cleaner",
    "Get Sweepr": "Obter o SWEEPR",
    "Get SWEEPR": "Obter o SWEEPR",
    "Download SWEEPR Cleaner": "Baixar SWEEPR Cleaner",
    "Download Free Scan": "Baixar verificação gratuita",
    "Revive your PC.": "Reviva seu PC.",
    "Special Introductory Plan": "Plano Especial de Lançamento",
    "Get Sweepr Cleaner Pro": "Obter SWEEPR Cleaner Pro",
    "Get SWEEPR Cleaner Pro": "Obter SWEEPR Cleaner Pro",
    "Includes 3 Desktop PCs + 2 Mobile Cleaner Apps": "Inclui 3 PCs Desktop + 2 Aplicativos de Limpeza Móvel",
    "100% Risk-Free 30-Day Money-Back Guarantee": "Garantia de 14 dias com 100% de reembolso",
    "100% Risk-Free 14-Day Money-Back Guarantee": "Garantia de 14 dias com 100% de reembolso",
    "30-Day Money-Back Guarantee": "Garantia de reembolso de 14 dias",
    "14-Day Money-Back Guarantee": "Garantia de reembolso de 14 dias",
    "Cancel Anytime in 1-Click": "Cancele a qualquer momento com 1 clique",
    "CLAIM DISCOUNT": "REIVINDICAR DESCONTO",
    "Claim Discount": "Reivindicar desconto",
    "1st Month Only": "Apenas 1º Mês",
    "Renews at": "Renova por",
    "Sweepr vs CCleaner": "SWEEPR Cleaner vs CCleaner",
    "SWEEPR Cleaner vs CCleaner": "SWEEPR Cleaner vs CCleaner",
    "CCleaner Alternatives": "Alternativas ao CCleaner",
    "Storage & Cache Directory": "Diretório de armazenamento e cache",
    "256-Bit SSL": "SSL de 256 bits",
    "Instant Delivery": "Entrega Imediata",
    "30-Day Refund": "Reembolso em 14 dias",
    "14-Day Refund": "Reembolso em 14 dias",
    "SPECIAL INTRODUCTORY OFFER": "OFERTA ESPECIAL DE INTRODUÇÃO",
    "Email Address": "Endereço de e-mail",
    "Continue": "Continuar"
  },
  nl: {
    "Features": "Functies",
    "Pricing": "Prijzen",
    "Compare & Guides": "Vergelijken & Handleidingen",
    "Login": "Inloggen",
    "Get Sweepr Cleaner": "SWEEPR Cleaner downloaden",
    "Get SWEEPR Cleaner": "SWEEPR Cleaner downloaden",
    "Get Sweepr": "SWEEPR downloaden",
    "Get SWEEPR": "SWEEPR downloaden",
    "Download SWEEPR Cleaner": "SWEEPR Cleaner downloaden",
    "Download Free Scan": "Gratis scan downloaden",
    "Revive your PC.": "Blaas uw pc nieuw leven in.",
    "Special Introductory Plan": "Speciaal introductieplan",
    "Get Sweepr Cleaner Pro": "SWEEPR Cleaner Pro aanschaffen",
    "Get SWEEPR Cleaner Pro": "SWEEPR Cleaner Pro aanschaffen",
    "30-Day Money-Back Guarantee": "14-dagen niet-goed-geld-terug-garantie",
    "14-Day Money-Back Guarantee": "14-dagen niet-goed-geld-terug-garantie",
    "Cancel Anytime in 1-Click": "Altijd opzegbaar in 1 klik",
    "CLAIM DISCOUNT": "KORTING CLAIMEN",
    "Claim Discount": "Korting claimen",
    "1st Month Only": "Alleen 1e maand",
    "Renews at": "Verlengt voor",
    "Sweepr vs CCleaner": "SWEEPR Cleaner vs CCleaner",
    "SWEEPR Cleaner vs CCleaner": "SWEEPR Cleaner vs CCleaner",
    "CCleaner Alternatives": "CCleaner alternatieven",
    "Storage & Cache Directory": "Opslag- & cachemap",
    "256-Bit SSL": "256-bits SSL",
    "Instant Delivery": "Directe levering",
    "30-Day Refund": "14 dagen retour",
    "14-Day Refund": "14 dagen retour",
    "SPECIAL INTRODUCTORY OFFER": "SPECIALE INTRODUCTIEAANBIEDING",
    "Email Address": "E-mailadres",
    "Continue": "Doorgaan"
  },
  ja: {
    "Features": "機能",
    "Pricing": "料金",
    "Compare & Guides": "比較とガイド",
    "Login": "ログイン",
    "Get Sweepr Cleaner": "SWEEPR Cleanerを入手",
    "Get SWEEPR Cleaner": "SWEEPR Cleanerを入手",
    "Get Sweepr": "SWEEPRを入手",
    "Get SWEEPR": "SWEEPRを入手",
    "Download SWEEPR Cleaner": "SWEEPR Cleanerをダウンロード",
    "Download Free Scan": "無料スキャンをダウンロード",
    "Revive your PC.": "PCのパフォーマンスを蘇らせる。",
    "Special Introductory Plan": "特別プレローンチプラン",
    "Get Sweepr Cleaner Pro": "SWEEPR Cleaner Proを入手",
    "Get SWEEPR Cleaner Pro": "SWEEPR Cleaner Proを入手",
    "30-Day Money-Back Guarantee": "14日間全額返金保証",
    "14-Day Money-Back Guarantee": "14日間全額返金保証",
    "Cancel Anytime in 1-Click": "いつでも1クリックで解約可能",
    "CLAIM DISCOUNT": "割引を適用する",
    "Claim Discount": "割引を適用",
    "1st Month Only": "初月のみ",
    "Renews at": "更新料金",
    "Sweepr vs CCleaner": "SWEEPR Cleaner vs CCleaner",
    "SWEEPR Cleaner vs CCleaner": "SWEEPR Cleaner vs CCleaner",
    "CCleaner Alternatives": "CCleanerの代替ツール",
    "Storage & Cache Directory": "ストレージ＆キャッシュディレクトリ",
    "256-Bit SSL": "256ビットSSL暗号化",
    "Instant Delivery": "即時ライセンス発行",
    "30-Day Refund": "14日間返金保証",
    "14-Day Refund": "14日間返金保証",
    "SPECIAL INTRODUCTORY OFFER": "特別プロモーション提供中",
    "Email Address": "メールアドレス",
    "Continue": "次へ進む"
  }
};

/**
 * Traverses and translates matching DOM text nodes losslessly
 */
function applyDictionary(lang) {
  const dict = I18N_DICTIONARY[lang];

  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (!text) return;

      if (node._origText === undefined) {
        node._origText = node.textContent;
      }

      if (lang === 'en') {
        node.textContent = node._origText;
        return;
      }

      if (dict) {
        const origTrimmed = node._origText.trim();
        if (dict[origTrimmed]) {
          node.textContent = node._origText.replace(origTrimmed, dict[origTrimmed]);
        }
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if (
        node.tagName === 'SCRIPT' ||
        node.tagName === 'STYLE' ||
        node.id === 'langDropdownMenu' ||
        node.id === 'langDropdownContainer'
      ) {
        return;
      }

      if (node.hasAttribute('placeholder')) {
        const ph = node.getAttribute('placeholder').trim();
        if (!node._origPh) node._origPh = ph;
        if (lang === 'en') {
          node.setAttribute('placeholder', node._origPh);
        } else if (dict && dict[node._origPh]) {
          node.setAttribute('placeholder', dict[node._origPh]);
        }
      }

      for (let child = node.firstChild; child; child = child.nextSibling) {
        walk(child);
      }
    }
  }

  walk(document.body);
}

/**
 * Changes language, updates dropdown UI, sets cookie & triggers Google Translate
 */
window.setLanguage = function(lang) {
  if (!LANGS[lang]) lang = 'en';

  try {
    localStorage.setItem('sweepr_lang', lang);
  } catch (e) {}

  // Update UI selector
  const flagEl = document.getElementById('currentLangFlag');
  const codeEl = document.getElementById('currentLangCode');
  if (flagEl) flagEl.textContent = LANGS[lang].flag;
  if (codeEl) codeEl.textContent = LANGS[lang].code;

  // Close dropdown
  const menu = document.getElementById('langDropdownMenu');
  const btn = document.getElementById('langDropdownBtn');
  const chevron = document.getElementById('langDropdownChevron');
  if (menu) menu.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (chevron) chevron.classList.remove('rotate-180');

  // Set Google Translate cookie
  const host = window.location.hostname;
  const cookieVal = `/en/${lang}`;
  if (lang === 'en') {
    document.cookie = 'googtrans=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    if (host && host !== 'localhost') {
      document.cookie = `googtrans=; Path=/; domain=${host}; Expires=Thu, 01 Jan 1970 00:00:01 GMT;`;
      document.cookie = `googtrans=; Path=/; domain=.${host}; Expires=Thu, 01 Jan 1970 00:00:01 GMT;`;
    }
  } else {
    document.cookie = `googtrans=${cookieVal}; path=/;`;
    if (host && host !== 'localhost') {
      document.cookie = `googtrans=${cookieVal}; path=/; domain=${host};`;
      document.cookie = `googtrans=${cookieVal}; path=/; domain=.${host};`;
    }
  }

  // 1. Instant client-side dictionary translation
  applyDictionary(lang);

  // 2. Trigger Google Translate combo if available
  const combo = document.querySelector('.goog-te-combo');
  if (combo) {
    if (combo.value !== lang) {
      combo.value = lang;
      combo.dispatchEvent(new Event('change'));
    }
  } else if (lang !== 'en') {
    // If google translate hasn't initialized yet, poll briefly
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const c = document.querySelector('.goog-te-combo');
      if (c) {
        c.value = lang;
        c.dispatchEvent(new Event('change'));
        clearInterval(interval);
      } else if (attempts > 10) {
        clearInterval(interval);
      }
    }, 300);
  }
};

// Setup dropdown toggling and init on DOM load
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('langDropdownBtn');
  const menu = document.getElementById('langDropdownMenu');
  const chevron = document.getElementById('langDropdownChevron');

  if (btn && menu) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = menu.classList.contains('hidden');
      if (isHidden) {
        menu.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
        if (chevron) chevron.classList.add('rotate-180');
      } else {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        if (chevron) chevron.classList.remove('rotate-180');
      }
    });

    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        if (chevron) chevron.classList.remove('rotate-180');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        menu.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
        if (chevron) chevron.classList.remove('rotate-180');
      }
    });
  }

  // Restore saved language
  try {
    const saved = localStorage.getItem('sweepr_lang');
    if (saved && LANGS[saved]) {
      const flagEl = document.getElementById('currentLangFlag');
      const codeEl = document.getElementById('currentLangCode');
      if (flagEl) flagEl.textContent = LANGS[saved].flag;
      if (codeEl) codeEl.textContent = LANGS[saved].code;

      if (saved !== 'en') {
        applyDictionary(saved);
      }
    }
  } catch (e) {}
});

// Google Translate Element callback
window.googleTranslateElementInit = function() {
  if (window.google && window.google.translate) {
    new window.google.translate.TranslateElement({
      pageLanguage: 'en',
      includedLanguages: 'en,de,fr,es,it,pt,nl,ja',
      autoDisplay: false
    }, 'google_translate_element');

    try {
      const saved = localStorage.getItem('sweepr_lang');
      if (saved && saved !== 'en') {
        setTimeout(() => {
          const combo = document.querySelector('.goog-te-combo');
          if (combo && combo.value !== saved) {
            combo.value = saved;
            combo.dispatchEvent(new Event('change'));
          }
        }, 300);
      }
    } catch (e) {}
  }
};
