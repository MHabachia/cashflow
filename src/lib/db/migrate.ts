import { ensureDatabaseTables } from "./index";

console.log("Starte Datenbank-Migration / Tabellen-Initialisierung...");
ensureDatabaseTables();
console.log("Datenbank erfolgreich initialisiert und auf dem neuesten Stand.");
