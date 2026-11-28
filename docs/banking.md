# Bankanbindung

Cashflow kann Bankbuchungen und Kreditkartenumsätze über PSD2 (Enable Banking) abrufen.

## Unterstützte Institute
- **Girokonten & Karten:**
  - **ING Deutschland** (Girokonto, Extra-Konto & VISA Debit Card)
  - **Sparkasse / Finanzgruppe** (Girokonten, Sparkassen-Card & Kreditkarten)
  - **C24 Bank (CHECK24)** (Smart-, Plus- & Max-Girokonto sowie C24 Mastercard)
  - **Commerzbank** (Girokonten, Girocard & Kreditkarten)
  - **Weitere:** DKB, Deutsche Bank, Postbank, Volksbanken & Raiffeisenbanken, N26, Revolut
- **Kreditkarten (Mastercard & VISA):**
  - **TF Bank** (TF Bank Mastercard Gold)
  - **Advanzia Bank** (gebührenfrei Mastercard Gold)
  - **C24 Bank Mastercard**
  - **ING VISA Debit**

## Einrichtung & Ablauf
1. Auf der Seite **Banking (`/banking`)** auf **„Bank verbinden“** klicken.
2. Gewünschte Bank oder Karte aus dem Katalog auswählen.
3. Weiterleitung zur Anmeldeseite der Bank; dort Login und Freigabe (die Zustimmung gilt 90 Tage).
4. Nach erfolgreicher Freigabe leitet die Bank zurück auf Cashflow (`/api/bank-sync/callback`). Die Konten und Karten werden angelegt.
5. Über **„Alle synchronisieren“** oder den Sync-Button am jeweiligen Konto werden neue Umsätze abgerufen, idempotent dedupliziert und automatisch bestehenden Fixkosten-Verträgen (Miete, Strom, Abos) bzw. Kategorien zugeordnet.

## Umbuchungen und manuelle Zuordnung

Nach jedem Abruf und Import sucht die App Umbuchungen zwischen deinen Konten: Eine Abbuchung und eine Gutschrift über denselben Betrag auf zwei verschiedenen Konten im Abstand von höchstens 3 Tagen werden als **Umbuchung & Ausgleich** markiert und zählen nicht als Ausgabe.

Änderst du bei einer Buchung Kategorie oder Kostenart von Hand (Bearbeiten, Massenänderung, Umsätze prüfen), merkt sich die App das. Solche Buchungen und Buchungen, die mit Fixkosten verknüpft sind, werden bei späteren Abrufen nicht mehr als Umbuchung gepaart. Auch **Regeln anwenden** mit Überschreiben lässt sie unverändert und meldet, wie viele übersprungen wurden. Selbst angelegte Buchungen gelten immer als von Hand zugeordnet.

Das gilt für Änderungen ab diesem Update (Migration 11); frühere Korrekturen kann die App nicht erkennen.

## Kartenausgleich für manuelle Kreditkarten

Kreditkarten ohne PSD2-Zugang (z. B. Advanzia, TF Bank) führst du als manuelles Konto. Wird ihr Ausgleich von einem deiner Konten abgebucht, kann die App den Kartensaldo automatisch anpassen:

1. Karte unter **Banking** bearbeiten und unter **Ausgleich vom Girokonto** das Konto wählen, von dem abgebucht wird.
2. **Erkennungsbegriff** prüfen (mindestens 4 Zeichen, Vorschlag aus dem Kartennamen, z. B. `advanzia`). Die Vorschau zeigt, wie viele Abbuchungen der letzten 90 Tage er trifft.
3. Speichern.

Ab dann gilt: Kommt auf dem Girokonto eine Abbuchung mit dem Begriff an (Bank-Sync oder Import), wird sie als Umbuchung markiert und zählt nicht als Ausgabe. Auf der Karte entsteht die passende Gutschrift, der Kartensaldo steigt um den Betrag. Jede Abbuchung wird nur einmal verarbeitet.

- Abgeglichen werden nur Abbuchungen ab dem Tag der Verknüpfung; ältere Ausgleiche bleiben, wie sie sind.
- Importierst du danach den Kartenauszug, wird die dort aufgeführte Zahlung als Duplikat übersprungen. Liegt die Gutschrift schon vor (Auszug vor der Abbuchung importiert), wird sie nur verknüpft.
- Per PSD2 angebundene Karten liefern die Gutschrift selbst und lassen sich nicht verknüpfen. Für manuell geführte Girokonten gibt es weiter **Kartenausgleich** von Hand.

## Konfiguration

Die Variablen für Enable Banking, Token-Verschlüsselung und Hintergrund-Abruf stehen in der [Konfiguration](configuration.md).

> Hinweis zu Reverse Proxy und Cloudflare Tunnel: Die Bank-Autorisierung erfordert, dass die Redirect-URL (`APP_URL + /api/bank-sync/callback`) exakt mit der in deinem Open-Banking-Entwicklerkonto registrierten URL übereinstimmt (z. B. `https://cashflow.deinedomain.de/api/bank-sync/callback`). `APP_URL` muss deshalb in der `.env` auf die richtige HTTPS-Adresse zeigen.
