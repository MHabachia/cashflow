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

## Konfiguration

Die Variablen für Enable Banking, Token-Verschlüsselung und Hintergrund-Abruf stehen in der [Konfiguration](configuration.md).

> Hinweis zu Reverse Proxy und Cloudflare Tunnel: Die Bank-Autorisierung erfordert, dass die Redirect-URL (`APP_URL + /api/bank-sync/callback`) exakt mit der in deinem Open-Banking-Entwicklerkonto registrierten URL übereinstimmt (z. B. `https://cashflow.deinedomain.de/api/bank-sync/callback`). `APP_URL` muss deshalb in der `.env` auf die richtige HTTPS-Adresse zeigen.
