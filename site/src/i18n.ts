import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

const en = {
  tagline: "Your phone is the lightgun.",
  intro:
    "Turn any ARCore Android phone into a drift-free lightgun for PC rail shooters — no extra hardware, no sensor bars, nothing to solder.",
  xr: {
    title: "Is my phone ready?",
    checking: "Checking WebXR support…",
    supported: "WebXR AR is supported — you're good to go!",
    supportedHint: "This phone can run the aim tracker. Follow the three steps below to play.",
    unsupported: "WebXR AR is not available on this device.",
    unsupportedHint:
      "You need an Android phone with ARCore support, Chrome, and “Google Play Services for AR” installed (free, from the Play Store). iPhones are not supported.",
    noWebxr: "This browser has no WebXR.",
    noWebxrHint:
      "On a desktop? Open this page on your Android phone to run the check. On the phone already? Use Chrome — other browsers may lack WebXR AR.",
    openAim: "Open the aim page",
  },
  video: {
    title: "See it in action",
    caption: "Time Crisis on a projector — the phone is the lightgun, no extra hardware.",
  },
  steps: {
    title: "Play in three steps",
    one: {
      title: "1 · Run point-bang on the PC",
      body: "Download the single executable for Windows or Linux (or clone the repo and npm start). It prints a QR code when it starts.",
    },
    two: {
      title: "2 · Scan the QR with the phone",
      body: "The aim page opens over HTTPS and finds your PC on the local network — no certificates, no accounts, no app install.",
    },
    three: {
      title: "3 · Tap Allow, calibrate, shoot",
      body: "Allow Chrome's one-time local-network prompt, point at your three screen corners, and the PC cursor follows your aim.",
    },
  },
  links: {
    title: "Links",
    docs: "Documentation",
    releases: "Downloads",
    github: "GitHub",
    firstGame: "Set up your first game",
  },
  quality: "Project health",
  footer:
    "MIT-licensed and open source. Community guides, hacks and mods are welcome — pull requests too.",
};

const de: typeof en = {
  tagline: "Dein Handy ist die Lightgun.",
  intro:
    "Verwandle jedes ARCore-Android-Handy in eine driftfreie Lightgun für PC-Railshooter — ohne Zusatzhardware, ohne Sensorleisten, ohne Löten.",
  xr: {
    title: "Ist mein Handy bereit?",
    checking: "WebXR-Unterstützung wird geprüft…",
    supported: "WebXR AR wird unterstützt — es kann losgehen!",
    supportedHint:
      "Dieses Handy kann den Aim-Tracker ausführen. Folge den drei Schritten unten, um zu spielen.",
    unsupported: "WebXR AR ist auf diesem Gerät nicht verfügbar.",
    unsupportedHint:
      "Du brauchst ein Android-Handy mit ARCore-Unterstützung, Chrome und „Google Play-Dienste für AR“ (kostenlos im Play Store). iPhones werden nicht unterstützt.",
    noWebxr: "Dieser Browser hat kein WebXR.",
    noWebxrHint:
      "Am Desktop? Öffne diese Seite auf deinem Android-Handy, um die Prüfung auszuführen. Schon am Handy? Nutze Chrome — anderen Browsern fehlt oft WebXR AR.",
    openAim: "Zur Aim-Seite",
  },
  video: {
    title: "In Aktion",
    caption: "Time Crisis am Projektor — das Handy ist die Lightgun, ohne Zusatzhardware.",
  },
  steps: {
    title: "In drei Schritten spielen",
    one: {
      title: "1 · point-bang am PC starten",
      body: "Lade die Einzeldatei für Windows oder Linux herunter (oder klone das Repo und npm start). Beim Start wird ein QR-Code angezeigt.",
    },
    two: {
      title: "2 · QR-Code mit dem Handy scannen",
      body: "Die Aim-Seite öffnet sich über HTTPS und findet deinen PC im lokalen Netzwerk — keine Zertifikate, keine Konten, keine App-Installation.",
    },
    three: {
      title: "3 · Erlauben, kalibrieren, schießen",
      body: "Erlaube Chromes einmalige Netzwerk-Abfrage, ziele auf die drei Bildschirmecken, und der PC-Cursor folgt deinem Ziel.",
    },
  },
  links: {
    title: "Links",
    docs: "Dokumentation",
    releases: "Downloads",
    github: "GitHub",
    firstGame: "Dein erstes Spiel einrichten",
  },
  quality: "Projektstatus",
  footer:
    "MIT-lizenziert und Open Source. Community-Guides, Hacks und Mods sind willkommen — Pull Requests auch.",
};

const it: typeof en = {
  tagline: "Il tuo telefono è la lightgun.",
  intro:
    "Trasforma qualsiasi telefono Android con ARCore in una lightgun senza deriva per i rail shooter su PC — niente hardware aggiuntivo, niente sensori, niente saldature.",
  xr: {
    title: "Il mio telefono è pronto?",
    checking: "Verifica del supporto WebXR…",
    supported: "WebXR AR è supportato — sei pronto!",
    supportedHint:
      "Questo telefono può eseguire il tracker di mira. Segui i tre passi qui sotto per giocare.",
    unsupported: "WebXR AR non è disponibile su questo dispositivo.",
    unsupportedHint:
      "Serve un telefono Android con supporto ARCore, Chrome e “Google Play Services per AR” installato (gratis dal Play Store). Gli iPhone non sono supportati.",
    noWebxr: "Questo browser non ha WebXR.",
    noWebxrHint:
      "Sei al computer? Apri questa pagina sul tuo telefono Android per eseguire la verifica. Già al telefono? Usa Chrome — altri browser spesso non hanno WebXR AR.",
    openAim: "Apri la pagina di mira",
  },
  video: {
    title: "In azione",
    caption: "Time Crisis su proiettore — il telefono è la lightgun, senza hardware aggiuntivo.",
  },
  steps: {
    title: "Gioca in tre passi",
    one: {
      title: "1 · Avvia point-bang sul PC",
      body: "Scarica l'eseguibile singolo per Windows o Linux (oppure clona il repo e npm start). All'avvio stampa un codice QR.",
    },
    two: {
      title: "2 · Inquadra il QR con il telefono",
      body: "La pagina di mira si apre in HTTPS e trova il tuo PC sulla rete locale — niente certificati, niente account, niente app da installare.",
    },
    three: {
      title: "3 · Consenti, calibra, spara",
      body: "Consenti la richiesta una-tantum di Chrome per la rete locale, punta i tre angoli dello schermo e il cursore del PC segue la tua mira.",
    },
  },
  links: {
    title: "Link",
    docs: "Documentazione",
    releases: "Download",
    github: "GitHub",
    firstGame: "Configura il tuo primo gioco",
  },
  quality: "Stato del progetto",
  footer:
    "Open source con licenza MIT. Guide, hack e mod della community sono benvenuti — anche le pull request.",
};

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      it: { translation: it },
    },
    fallbackLng: "en",
    supportedLngs: ["en", "de", "it"],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
  });

export default i18n;
