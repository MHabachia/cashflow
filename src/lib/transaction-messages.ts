/**
 * Meldungen zu Buchungen, die Server Actions und Oberfläche teilen.
 * Eigenes Modul, weil "use server"-Dateien nur async-Funktionen exportieren dürfen.
 */

/**
 * Von der Bank synchronisierte Buchungen sind Teil des Kontoauszugs: Löschen
 * würde den Saldo verfälschen, und der nächste Abruf importierte sie erneut.
 */
export const BANK_TRANSACTION_DELETE_ERROR =
  "Von der Bank übernommene Buchungen lassen sich nicht löschen. Ändere stattdessen Kategorie oder Kostenart (z. B. „Umbuchung“).";
