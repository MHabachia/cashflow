# ADR 0001: Vertrag für Server Actions

- Status: angenommen
- Datum: 2026-11-28

## Kontext

Server Actions (`src/actions/*.ts`, Dateien mit `"use server"`) sind öffentlich aufrufbare HTTP-Endpunkte. TypeScript-Typen der Parameter gelten zur Laufzeit nicht: Ein Client kann beliebiges JSON schicken, also Strings statt Zahlen, Kommazahlen in Cent-Feldern, unbekannte Enum-Werte oder IDs fremder Datensätze.

Die Sicherheitsanalyse von November 2026 fand dazu konkrete Fehler:

- Eine exportierte Funktion nahm eine `userId` entgegen und prüfte keine Sitzung.
- Konto- und Kategorie-IDs aus dem Client wurden nicht auf Eigentum geprüft.
- Mehrere Actions mit Geldbeträgen hatten kein Schema. `500 + "1e9"` ergab durch String-Verkettung `"5001e9"`, und dieser Wert landete im Saldo.

## Entscheidung

Jede exportierte Server Action hält sich an diese Regeln:

1. **Sitzung zuerst:** `requireUser()` bzw. `requireAdmin()` als erste Anweisung. Exporte in `src/actions/` nehmen nie eine `userId` als Parameter an. Hilfsfunktionen, die einer `userId` vertrauen, liegen in `src/lib/` ohne `"use server"`.
2. **Eingabe mit zod prüfen:** Jede Eingabe außer einer einzelnen ID läuft durch ein zod-Schema. Gemeinsame Bausteine liegen in `src/lib/validation.ts`: Cent-Beträge als ganze Zahlen mit Obergrenze, echte Kalenderdaten, ID-Listen mit Höchstlänge, Farben. Weiterverarbeitet werden nur die geparsten Daten.
3. **Eigentum prüfen:** Jede ID aus dem Client, die auf einen anderen Datensatz verweist (Kategorie, Konto, Elternkategorie), wird mit `src/lib/ownership.ts` oder einer Abfrage mit `userId`-Filter geprüft. Joins auf solche Tabellen filtern ebenfalls nach `userId`.
4. **Fehler als Rückgabewert:** Actions geben `{ success: false, error }` mit einer verständlichen Meldung zurück, statt Ausnahmen an den Client durchzureichen.

## Alternativen

- **Nur TypeScript-Typen:** reicht nicht, weil die Typen zur Laufzeit nicht gelten.
- **Wrapper-Funktion für alle Actions** (Sitzung, Schema und Eigentum in einem): einheitlicher, verlangt aber eine größere Umstellung aller Actions auf einmal. Später möglich, wenn die Regeln überall umgesetzt sind.
- **Datenbank-Constraints allein:** Fremdschlüssel prüfen nur, ob ein Datensatz existiert, nicht wem er gehört.

## Folgen

- Neue Actions brauchen ein Schema; Reviews prüfen die vier Regeln.
- Die Oberfläche bekommt bei ungültigen Werten eine Fehlermeldung statt eines stillen Fehlverhaltens.
- Für Actions, die nur eine einzelne ID annehmen, bleibt die Prüfung über die parametrisierte Abfrage mit `userId`-Filter. Ein eigenes Schema ist dort nicht vorgeschrieben.
