// Translations for the button editor page. Hand-rolled on purpose: public/
// is buildless and dependency-free (i18next lives only in the site/ package,
// which has its own bundler). Same three languages as the hosted start page.
// Plain JS ES module, imported by editor.html AND vitest, typed via JSDoc.

/** @type {Record<"en" | "de" | "it", Record<string, string>>} */
export const translations = {
  en: {
    title: "point-bang — button editor",
    "header.title": "Button editor",
    "header.save": "Save",
    "status.loading": "loading buttons.json…",
    "status.editing": "editing the live config — Save applies without a restart",
    "status.saving": "saving…",
    "status.saved": "saved (rev {rev}) — PC remapped, phone updated live",
    "status.refused": "save refused (HTTP {status}): {detail}",
    "status.refusedFallback": "see the problem list / server log",
    "status.saveFailed": "save failed: {error}",
    "status.loadFailed": "could not load buttons.json: {error}",
    "intro.title": "What is this?",
    "intro.body":
      "These buttons appear on your phone screen during play. Pick one below, give it an action (a key or mouse click on the PC), drag it where your thumb can reach — then hit Save. It applies instantly: no restart, no recalibration.",
    "intro.dismiss": "Got it",
    "frame.landscape": "landscape phone",
    "frame.hint":
      "The canvas is your phone's screen. Positions are % of the screen, so they fit any phone — the default layout was designed for playing with the phone held sideways.",
    "under.addButton": "＋ add button…",
    "under.addButtonTitle": "turn one of the unused slots into a visible button",
    "under.place": "place on canvas:",
    "under.hint": "Drag a button to move it. Drag a corner to resize. Tap to edit its details.",
    "section.button": "Button",
    "section.action": "Action on the PC",
    "section.placement": "Placement on the phone",
    "section.triggers": "Extra triggers",
    "section.feedback": "Feedback",
    "field.label": "label",
    "field.labelHint": "the text shown on the phone button",
    "field.visible": "visible on the phone screen",
    "field.visibleHint": "hidden buttons can still fire via the extra triggers below",
    "field.reset": "reset this button",
    "field.resetHint": "back to factory empty: no action, hidden, everything cleared",
    "action.type": "what happens on the PC",
    "action.typeNone": "nothing (unassigned)",
    "action.typeMouse": "mouse click",
    "action.typeKey": "keyboard key / combo",
    "action.mouseButton": "mouse button",
    "action.mouseLeft": "left click",
    "action.mouseRight": "right click",
    "action.mouseMiddle": "middle click",
    "action.key": "key",
    "action.keyNone": "— pick a key —",
    "action.result": "resulting action",
    "action.advanced": "advanced: edit as text",
    "action.rawHint": "this combo is more than the builder can show — edit it as text below",
    "action.hint":
      "Example: 'keyboard key' + Ctrl + Shift + F presses Ctrl+Shift+F in your game whenever the button is held.",
    "keys.group.modifiers": "modifiers",
    "keys.group.letters": "letters",
    "keys.group.digits": "digits",
    "keys.group.function": "function keys",
    "keys.group.numpad": "numpad",
    "keys.group.navigation": "navigation",
    "keys.group.editing": "editing",
    "keys.group.punctuation": "punctuation",
    "keys.group.system": "system",
    "placement.placed": "placed at {x},{y} — {w}×{h}% of the screen",
    "placement.strip": "in the scrollable strip at the bottom (no fixed spot)",
    "placement.place": "place on canvas",
    "placement.remove": "remove from canvas (back to the strip)",
    "placement.hint":
      "Placed buttons sit exactly where you drag them; strip buttons queue up at the bottom edge.",
    "triggers.edge": "off-screen edge",
    "triggers.edgeNone": "none",
    "triggers.edgeAny": "any edge",
    "triggers.edgeLeft": "left",
    "triggers.edgeRight": "right",
    "triggers.edgeTop": "top",
    "triggers.edgeBottom": "bottom",
    "triggers.edgeHint":
      "Aim past that screen edge for a moment = press; aim back on screen = release. The classic arcade reload: point at the floor to duck. 'Any edge' fires no matter which edge you leave.",
    "triggers.pad": "physical button (Bluetooth)",
    "triggers.padNone": "none",
    "triggers.padAny": "any gamepad button",
    "triggers.padSpecific": "one specific button",
    "triggers.padIndex": "button number",
    "triggers.padHint":
      "Pair a Bluetooth gamepad or camera clicker with the PHONE. Press any of its buttons during a session — the phone HUD shows that button's number; enter it here. 'Any' works for one-button clickers.",
    "feedback.vibrate": "vibration on press",
    "feedback.vibrateDefault": "default (short tick)",
    "feedback.vibrateOff": "off",
    "feedback.vibrateCustom": "custom length",
    "feedback.vibrateMs": "milliseconds (max 100)",
    "feedback.hint":
      "A tiny tick confirms the press. Keep it short — the motor shakes the same phone that tracks your aim.",
    "list.hidden": "hidden",
    "problems.preamble": "The server would refuse this config:",
  },
  de: {
    title: "point-bang — Button-Editor",
    "header.title": "Button-Editor",
    "header.save": "Speichern",
    "status.loading": "buttons.json wird geladen…",
    "status.editing": "Live-Konfiguration — Speichern wirkt ohne Neustart",
    "status.saving": "speichern…",
    "status.saved": "gespeichert (Rev {rev}) — PC neu belegt, Handy live aktualisiert",
    "status.refused": "Speichern abgelehnt (HTTP {status}): {detail}",
    "status.refusedFallback": "siehe Problemliste / Server-Log",
    "status.saveFailed": "Speichern fehlgeschlagen: {error}",
    "status.loadFailed": "buttons.json konnte nicht geladen werden: {error}",
    "intro.title": "Was ist das hier?",
    "intro.body":
      "Diese Buttons erscheinen beim Spielen auf deinem Handy-Bildschirm. Wähle unten einen aus, gib ihm eine Aktion (Taste oder Mausklick am PC), zieh ihn dahin, wo dein Daumen hinkommt — dann Speichern. Es wirkt sofort: kein Neustart, keine Neukalibrierung.",
    "intro.dismiss": "Verstanden",
    "frame.landscape": "Handy quer",
    "frame.hint":
      "Die Fläche ist dein Handy-Bildschirm. Positionen sind % des Bildschirms und passen auf jedes Handy — das Standard-Layout ist fürs Spielen mit quer gehaltenem Handy gedacht.",
    "under.addButton": "＋ Button hinzufügen…",
    "under.addButtonTitle": "einen der freien Plätze als sichtbaren Button aktivieren",
    "under.place": "auf die Fläche legen:",
    "under.hint":
      "Button ziehen = verschieben. An einer Ecke ziehen = Größe ändern. Antippen = Details bearbeiten.",
    "section.button": "Button",
    "section.action": "Aktion am PC",
    "section.placement": "Platzierung auf dem Handy",
    "section.triggers": "Zusätzliche Auslöser",
    "section.feedback": "Rückmeldung",
    "field.label": "Beschriftung",
    "field.labelHint": "der Text auf dem Handy-Button",
    "field.visible": "auf dem Handy sichtbar",
    "field.visibleHint": "versteckte Buttons feuern trotzdem über die Auslöser unten",
    "field.reset": "Button zurücksetzen",
    "field.resetHint": "zurück auf Werkszustand: keine Aktion, versteckt, alles gelöscht",
    "action.type": "was am PC passiert",
    "action.typeNone": "nichts (nicht belegt)",
    "action.typeMouse": "Mausklick",
    "action.typeKey": "Taste / Tastenkombination",
    "action.mouseButton": "Maustaste",
    "action.mouseLeft": "Linksklick",
    "action.mouseRight": "Rechtsklick",
    "action.mouseMiddle": "Mittelklick",
    "action.key": "Taste",
    "action.keyNone": "— Taste wählen —",
    "action.result": "ergibt die Aktion",
    "action.advanced": "erweitert: als Text bearbeiten",
    "action.rawHint":
      "diese Kombination kann der Baukasten nicht darstellen — unten als Text bearbeiten",
    "action.hint":
      "Beispiel: „Taste“ + Strg + Umschalt + F drückt im Spiel Ctrl+Shift+F, solange der Button gehalten wird.",
    "keys.group.modifiers": "Modifikatoren",
    "keys.group.letters": "Buchstaben",
    "keys.group.digits": "Ziffern",
    "keys.group.function": "Funktionstasten",
    "keys.group.numpad": "Ziffernblock",
    "keys.group.navigation": "Navigation",
    "keys.group.editing": "Bearbeiten",
    "keys.group.punctuation": "Zeichen",
    "keys.group.system": "System",
    "placement.placed": "platziert bei {x},{y} — {w}×{h}% des Bildschirms",
    "placement.strip": "in der scrollbaren Leiste unten (kein fester Platz)",
    "placement.place": "auf die Fläche legen",
    "placement.remove": "von der Fläche nehmen (zurück in die Leiste)",
    "placement.hint":
      "Platzierte Buttons sitzen genau da, wo du sie hinziehst; Leisten-Buttons reihen sich unten auf.",
    "triggers.edge": "Bildschirmrand",
    "triggers.edgeNone": "keiner",
    "triggers.edgeAny": "jeder Rand",
    "triggers.edgeLeft": "links",
    "triggers.edgeRight": "rechts",
    "triggers.edgeTop": "oben",
    "triggers.edgeBottom": "unten",
    "triggers.edgeHint":
      "Kurz über den Rand hinaus zielen = drücken; zurück auf den Bildschirm = loslassen. Das klassische Arcade-Nachladen: auf den Boden zielen zum Ducken. „Jeder Rand“ feuert egal an welchem Rand.",
    "triggers.pad": "physische Taste (Bluetooth)",
    "triggers.padNone": "keine",
    "triggers.padAny": "jede Gamepad-Taste",
    "triggers.padSpecific": "eine bestimmte Taste",
    "triggers.padIndex": "Tastennummer",
    "triggers.padHint":
      "Kopple ein Bluetooth-Gamepad oder einen Kamera-Auslöser mit dem HANDY. Drücke eine Taste während einer Session — das HUD auf dem Handy zeigt ihre Nummer; trag sie hier ein. „Jede“ passt für Ein-Knopf-Auslöser.",
    "feedback.vibrate": "Vibration beim Drücken",
    "feedback.vibrateDefault": "Standard (kurzer Tick)",
    "feedback.vibrateOff": "aus",
    "feedback.vibrateCustom": "eigene Länge",
    "feedback.vibrateMs": "Millisekunden (max. 100)",
    "feedback.hint":
      "Ein winziger Tick bestätigt den Druck. Kurz halten — der Motor schüttelt genau das Handy, das dein Zielen trackt.",
    "list.hidden": "versteckt",
    "problems.preamble": "Der Server würde diese Konfiguration ablehnen:",
  },
  it: {
    title: "point-bang — editor dei pulsanti",
    "header.title": "Editor dei pulsanti",
    "header.save": "Salva",
    "status.loading": "caricamento di buttons.json…",
    "status.editing": "configurazione live — Salva si applica senza riavvio",
    "status.saving": "salvataggio…",
    "status.saved": "salvato (rev {rev}) — PC rimappato, telefono aggiornato live",
    "status.refused": "salvataggio rifiutato (HTTP {status}): {detail}",
    "status.refusedFallback": "vedi l'elenco dei problemi / log del server",
    "status.saveFailed": "salvataggio non riuscito: {error}",
    "status.loadFailed": "impossibile caricare buttons.json: {error}",
    "intro.title": "Che cos'è questo?",
    "intro.body":
      "Questi pulsanti compaiono sullo schermo del telefono durante il gioco. Scegline uno qui sotto, assegnagli un'azione (un tasto o un clic sul PC), trascinalo dove arriva il pollice — poi Salva. Si applica subito: nessun riavvio, nessuna ricalibrazione.",
    "intro.dismiss": "Capito",
    "frame.landscape": "telefono orizzontale",
    "frame.hint":
      "L'area è lo schermo del telefono. Le posizioni sono in % dello schermo, quindi valgono per qualsiasi telefono — il layout predefinito è pensato per giocare col telefono in orizzontale.",
    "under.addButton": "＋ aggiungi pulsante…",
    "under.addButtonTitle": "attiva uno degli slot liberi come pulsante visibile",
    "under.place": "metti sull'area:",
    "under.hint":
      "Trascina un pulsante per spostarlo. Trascina un angolo per ridimensionarlo. Toccalo per modificarne i dettagli.",
    "section.button": "Pulsante",
    "section.action": "Azione sul PC",
    "section.placement": "Posizione sul telefono",
    "section.triggers": "Attivazioni extra",
    "section.feedback": "Feedback",
    "field.label": "etichetta",
    "field.labelHint": "il testo mostrato sul pulsante del telefono",
    "field.visible": "visibile sullo schermo del telefono",
    "field.visibleHint":
      "i pulsanti nascosti possono comunque attivarsi con le attivazioni qui sotto",
    "field.reset": "reimposta questo pulsante",
    "field.resetHint": "torna vuoto come in origine: nessuna azione, nascosto, tutto azzerato",
    "action.type": "cosa succede sul PC",
    "action.typeNone": "niente (non assegnato)",
    "action.typeMouse": "clic del mouse",
    "action.typeKey": "tasto / combinazione di tastiera",
    "action.mouseButton": "pulsante del mouse",
    "action.mouseLeft": "clic sinistro",
    "action.mouseRight": "clic destro",
    "action.mouseMiddle": "clic centrale",
    "action.key": "tasto",
    "action.keyNone": "— scegli un tasto —",
    "action.result": "azione risultante",
    "action.advanced": "avanzato: modifica come testo",
    "action.rawHint": "questa combinazione supera il costruttore — modificala come testo qui sotto",
    "action.hint":
      "Esempio: «tasto» + Ctrl + Maiusc + F preme Ctrl+Shift+F nel gioco finché il pulsante resta premuto.",
    "keys.group.modifiers": "modificatori",
    "keys.group.letters": "lettere",
    "keys.group.digits": "cifre",
    "keys.group.function": "tasti funzione",
    "keys.group.numpad": "tastierino",
    "keys.group.navigation": "navigazione",
    "keys.group.editing": "modifica",
    "keys.group.punctuation": "punteggiatura",
    "keys.group.system": "sistema",
    "placement.placed": "posizionato a {x},{y} — {w}×{h}% dello schermo",
    "placement.strip": "nella barra scorrevole in basso (nessuna posizione fissa)",
    "placement.place": "metti sull'area",
    "placement.remove": "togli dall'area (torna nella barra)",
    "placement.hint":
      "I pulsanti posizionati stanno esattamente dove li trascini; quelli della barra si accodano in basso.",
    "triggers.edge": "bordo fuori schermo",
    "triggers.edgeNone": "nessuno",
    "triggers.edgeAny": "qualsiasi bordo",
    "triggers.edgeLeft": "sinistro",
    "triggers.edgeRight": "destro",
    "triggers.edgeTop": "superiore",
    "triggers.edgeBottom": "inferiore",
    "triggers.edgeHint":
      "Mira oltre quel bordo per un attimo = premuto; torna sullo schermo = rilasciato. La ricarica arcade classica: mira al pavimento per abbassarti. «Qualsiasi bordo» scatta da ogni lato.",
    "triggers.pad": "pulsante fisico (Bluetooth)",
    "triggers.padNone": "nessuno",
    "triggers.padAny": "qualsiasi pulsante del gamepad",
    "triggers.padSpecific": "un pulsante specifico",
    "triggers.padIndex": "numero del pulsante",
    "triggers.padHint":
      "Associa un gamepad Bluetooth o uno scatto remoto al TELEFONO. Premi un suo pulsante durante una sessione — l'HUD del telefono ne mostra il numero; inseriscilo qui. «Qualsiasi» va bene per i telecomandi a un tasto.",
    "feedback.vibrate": "vibrazione alla pressione",
    "feedback.vibrateDefault": "predefinita (tick breve)",
    "feedback.vibrateOff": "spenta",
    "feedback.vibrateCustom": "durata personalizzata",
    "feedback.vibrateMs": "millisecondi (max 100)",
    "feedback.hint":
      "Un piccolo tick conferma la pressione. Tienilo breve — il motore scuote lo stesso telefono che traccia la tua mira.",
    "list.hidden": "nascosto",
    "problems.preamble": "Il server rifiuterebbe questa configurazione:",
  },
};

/**
 * Resolves the editor language: a stored choice wins if supported, else the
 * first navigator language matching by prefix (de-CH -> de), else "en".
 * @param {readonly string[]} navigatorLanguages
 * @param {string | null} stored
 * @returns {"en" | "de" | "it"}
 */
export function pickLanguage(navigatorLanguages, stored) {
  const supported = /** @type {const} */ (["en", "de", "it"]);
  if (stored && supported.includes(/** @type {"en"|"de"|"it"} */ (stored)))
    return /** @type {"en"|"de"|"it"} */ (stored);
  for (const nav of navigatorLanguages ?? []) {
    const prefix = nav.toLowerCase().slice(0, 2);
    const hit = supported.find((s) => s === prefix);
    if (hit) return hit;
  }
  return "en";
}

/**
 * Translator factory. Missing keys fall back to English, then echo the key
 * itself (a visible bug beats a blank label). `{name}` placeholders are
 * replaced from `params`.
 * @param {string} lang
 * @returns {(key: string, params?: Record<string, string | number>) => string}
 */
export function makeT(lang) {
  const dict = translations[/** @type {"en"|"de"|"it"} */ (lang)] ?? translations.en;
  return (key, params) => {
    let text = dict[key] ?? translations.en[key] ?? key;
    for (const [name, value] of Object.entries(params ?? {}))
      text = text.replaceAll(`{${name}}`, String(value));
    return text;
  };
}
