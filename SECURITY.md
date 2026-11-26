# Sicherheit

## Unterstützte Versionen

Sicherheitskorrekturen gibt es für das jeweils neueste Release. Bitte vor einer Meldung prüfen, ob das Problem dort noch besteht.

## Schwachstelle melden

Bitte **kein öffentliches Issue** anlegen. Melde Schwachstellen vertraulich über GitHub:
[Security → Report a vulnerability](https://github.com/MHabachia/cashflow/security/advisories/new).

Hilfreich sind:

- betroffene Version bzw. Image-Tag,
- Schritte zum Nachvollziehen,
- mögliche Auswirkungen (z. B. Zugriff auf fremde Daten, Umgehen der Anmeldung).

Du bekommst in der Regel innerhalb einer Woche eine erste Rückmeldung. Nach der Korrektur wird die Lücke im Changelog unter „Security“ genannt, auf Wunsch mit Namensnennung.

## Bekannte Einschränkungen

- Die Kontosperre nach Fehlversuchen liegt im Arbeitsspeicher: Sie gilt pro Instanz und wird bei einem Neustart zurückgesetzt. Sie betrifft nur die Anmeldung mit Passwort, nicht Passkeys.
- Die Content-Security-Policy erlaubt `style-src 'unsafe-inline'`, weil die Diagramm-Bibliothek (Recharts) und die Hinweis-Meldungen (sonner) Inline-Styles setzen. Skripte sind davon nicht betroffen (Nonce, `strict-dynamic`).
- HSTS wird ohne `includeSubDomains` und `preload` gesetzt, damit andere Dienste auf Subdomains nicht ungewollt auf HTTPS gezwungen werden.
