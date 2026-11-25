export interface DefaultRulePreset {
  name: string;
  pattern: string;
  matchField: "all" | "merchant" | "description";
  categoryMatchName: string; // z. B. "Lebensmittel", wird mit existierenden Kategorien des Users gemappt
  costType: "variable" | "fixed" | "transfer";
  priority: number;
  /** Standardmäßig deaktiviert anlegen (z. B. nur sinnvoll bei bestimmter Kontoführung) */
  inactiveByDefault?: boolean;
}

export const DEFAULT_RULE_PRESETS: DefaultRulePreset[] = [
  // 1. Lebensmittel & Supermärkte
  {
    name: "Supermärkte & Discounter",
    pattern: "rewe|edeka|aldi|lidl|kaufland|penny|netto|tegut|norma|alnatura|denns|hit markt",
    matchField: "all",
    categoryMatchName: "Lebensmittel",
    costType: "variable",
    priority: 80,
  },
  {
    name: "Bäcker & Metzger",
    pattern: "bäckerei|baeckerei|konditorei|metzgerei|fleischerei|backwerk|ihle backstube|kamps",
    matchField: "all",
    categoryMatchName: "Lebensmittel",
    costType: "variable",
    priority: 75,
  },

  // 2. Drogerie & Gesundheit
  {
    name: "Drogeriemärkte",
    pattern: "dm-drogerie|dm drogerie|rossmann|müller drogerie|mueller drogerie|budni",
    matchField: "all",
    categoryMatchName: "Gesundheit & Drogerie",
    costType: "variable",
    priority: 80,
  },
  {
    name: "Apotheken & Ärzte",
    pattern: "apotheke|docmorris|shop-apotheke|arzt|praxis|zahnarzt|labor",
    matchField: "all",
    categoryMatchName: "Gesundheit & Drogerie",
    costType: "variable",
    priority: 75,
  },

  // 3. Mobilität, Tanken & Bahn
  {
    name: "Tankstellen",
    pattern: "aral|shell|totalenergies|total tankstelle|esso|jet tankstelle|hem tankstelle|omv|avia",
    matchField: "all",
    categoryMatchName: "Mobilität & Tanken",
    costType: "variable",
    priority: 85,
  },
  {
    name: "Öffentlicher Verkehr & Bahn",
    pattern: "deutsche bahn|db vertrieb|bvg|hvv|mvg|vvs|kvb|flixbus|flixtrain|sbahn|u-bahn",
    matchField: "all",
    categoryMatchName: "Mobilität & Tanken",
    costType: "variable",
    priority: 80,
  },
  {
    name: "Fahrdienste & Parken",
    pattern: "uber|bolt|free now|taxi|easypark|parken|apcoa|clever tanken",
    matchField: "all",
    categoryMatchName: "Mobilität & Tanken",
    costType: "variable",
    priority: 75,
  },

  // 4. Abos & Streaming
  {
    name: "Streaming & Musik-Abos",
    pattern: "netflix|spotify|disney plus|disney+|amazon prime|apple.com/bill|youtube premium|dazn|sky deutschland|wow tv|deezer|audible",
    matchField: "all",
    categoryMatchName: "Abos & Verträge",
    costType: "fixed",
    priority: 90,
  },
  {
    name: "Rundfunkbeitrag (GEZ)",
    pattern: "rundfunkbeitrag|ard zdf|beitragsservice",
    matchField: "all",
    categoryMatchName: "Abos & Verträge",
    costType: "fixed",
    priority: 95,
  },
  {
    name: "Mobilfunk & Internet",
    pattern: "telekom|vodafone|o2 germany|telefonica|1&1|congstar|freenet|fraenk|simon mobile",
    matchField: "all",
    categoryMatchName: "Abos & Verträge",
    costType: "fixed",
    priority: 85,
  },

  // 5. Wohnen & Energie
  {
    name: "Miete & Hausgeld",
    pattern: "miete|hausgeld|wohnungsbau|wohnung|mietzins",
    matchField: "all",
    categoryMatchName: "Wohnen & Miete",
    costType: "fixed",
    priority: 95,
  },
  {
    name: "Strom & Gas (Stadtwerke)",
    pattern: "stadtwerke|vattenfall|e.on|eon energie|mainova|rheinenergie|enbw|yello|tibber|gasag",
    matchField: "all",
    categoryMatchName: "Wohnen & Miete",
    costType: "fixed",
    priority: 90,
  },

  // 6. Gastronomie & Restaurants
  {
    name: "Gastronomie & Lieferdienste",
    pattern: "lieferando|wolt|ubereats|mcdonalds|burger king|kfc|subway|vapiano|starbucks|ristorante|pizzeria|restaurant",
    matchField: "all",
    categoryMatchName: "Restaurant & Café",
    costType: "variable",
    priority: 75,
  },

  // 7. Shopping & Elektronik
  {
    name: "Online-Shopping & Elektronik",
    pattern: "amazon|otto gmbh|otto.de|zalando|mediamarkt|saturn|apple store|ikea|action gmbh|tedi",
    matchField: "all",
    categoryMatchName: "Shopping & Freizeit",
    costType: "variable",
    priority: 65,
  },

  // 8. Einnahmen
  {
    name: "Gehalt & Lohn",
    pattern: "gehalt|lohn|bezug|salary|arbeitsentgelt|arbeitgeber",
    matchField: "all",
    categoryMatchName: "Gehalt & Einnahmen",
    costType: "fixed",
    priority: 95,
  },
  {
    name: "Kindergeld & Familienkasse",
    pattern: "kindergeld|familienkasse|elterngeld",
    matchField: "all",
    categoryMatchName: "Gehalt & Einnahmen",
    costType: "fixed",
    priority: 95,
  },

  // 9. Umbuchungen & Zahlungsdienste
  {
    // Nur sinnvoll, wenn das PayPal-Konto selbst als Konto geführt wird – sonst
    // würden alle PayPal-Käufe als neutrale Umbuchung aus den Ausgaben fallen.
    name: "PayPal-Abbuchung als Umbuchung (nur mit PayPal-Konto)",
    inactiveByDefault: true,
    pattern: "paypal europe|paypal (europe)|paypal lastschrift|paypal abbuchung",
    matchField: "all",
    categoryMatchName: "Umbuchung & Ausgleich",
    costType: "transfer",
    priority: 85,
  },
  {
    // Ersetzt das frühere „Kleingeld Plus“-Sparen: Aufrundungsbeträge sind
    // Sparen, keine Ausgabe – auch wenn das Sparkonto nicht geführt wird
    name: "Kleingeld- & Aufrundungssparen",
    pattern: "kleingeld plus|kleingeldplus|aufrundungssparen|aufrundung sparen",
    matchField: "all",
    categoryMatchName: "Umbuchung & Ausgleich",
    costType: "transfer",
    priority: 86,
  },
  {
    name: "Kreditkarten-Ausgleich & Übertrag",
    pattern: "kreditkartenabrechnung|kartenausgleich|übertrag eigenes konto|umbuchung eigenes konto",
    matchField: "all",
    categoryMatchName: "Umbuchung & Ausgleich",
    costType: "transfer",
    priority: 85,
  },
];
