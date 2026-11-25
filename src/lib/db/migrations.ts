import type Database from "better-sqlite3";

/**
 * Versionierte Datenbank-Migrationen.
 *
 * Regeln:
 * - Jede Migration hat eine fortlaufende `id` und wird genau einmal ausgeführt
 *   (Protokoll in der Tabelle `schema_migrations`).
 * - Bestehende Migrationen werden NIE nachträglich geändert. Schemaänderungen
 *   kommen immer als neue Migration ans Ende der Liste.
 * - Migration 1 ("baseline") enthält das historisch gewachsene, idempotente
 *   Schema und bringt auch ältere Datenbanken auf den Stand von v1.9.
 */

type Sqlite = Database.Database;

export interface Migration {
  id: number;
  name: string;
  /** false für Migrationen, die selbst PRAGMA foreign_keys umschalten */
  transactional?: boolean;
  up: (sqlite: Sqlite) => void;
}

function applyBaselineSchema(sqlite: Sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      email_verified INTEGER DEFAULT 0 NOT NULL,
      image TEXT,
      role TEXT DEFAULT 'user' NOT NULL,
      banned INTEGER DEFAULT 0 NOT NULL,
      two_factor_enabled INTEGER DEFAULT 0 NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY NOT NULL,
      expires_at INTEGER NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      access_token TEXT,
      refresh_token TEXT,
      id_token TEXT,
      access_token_expires_at INTEGER,
      refresh_token_expires_at INTEGER,
      scope TEXT,
      password TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY NOT NULL,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS two_factor (
      id TEXT PRIMARY KEY NOT NULL,
      secret TEXT NOT NULL,
      backup_codes TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      failed_verification_count INTEGER DEFAULT 0,
      locked_until INTEGER,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS passkey (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      public_key TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      credential_id TEXT NOT NULL,
      counter INTEGER NOT NULL,
      device_type TEXT NOT NULL,
      backed_up INTEGER NOT NULL,
      transports TEXT,
      created_at INTEGER,
      aaguid TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_passkey_user ON passkey(user_id);

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY NOT NULL,
      token TEXT NOT NULL UNIQUE,
      email TEXT,
      created_by TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      used_by TEXT REFERENCES user(id) ON DELETE SET NULL,
      used_at INTEGER,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#3b82f6' NOT NULL,
      icon TEXT DEFAULT 'ShoppingCart' NOT NULL,
      type TEXT DEFAULT 'expense' NOT NULL,
      sort_order INTEGER DEFAULT 0 NOT NULL,
      is_default INTEGER DEFAULT 0 NOT NULL,
      is_archived INTEGER DEFAULT 0 NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id, is_archived);

    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      type TEXT DEFAULT 'expense' NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      amount_cents INTEGER NOT NULL,
      payment_method TEXT DEFAULT 'direct_debit' NOT NULL,
      interval TEXT DEFAULT 'monthly' NOT NULL,
      day_of_month INTEGER DEFAULT 1 NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT,
      next_due_date TEXT NOT NULL,
      last_processed_date TEXT,
      auto_book INTEGER DEFAULT 1 NOT NULL,
      active INTEGER DEFAULT 1 NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_user_due ON recurring_expenses(user_id, active, next_due_date);

    CREATE TABLE IF NOT EXISTS variable_presets (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      type TEXT DEFAULT 'expense' NOT NULL,
      name TEXT NOT NULL,
      default_amount_cents INTEGER,
      payment_method TEXT DEFAULT 'apple_pay' NOT NULL,
      usage_count INTEGER DEFAULT 0 NOT NULL,
      sort_order INTEGER DEFAULT 0 NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_presets_user ON variable_presets(user_id, usage_count);

    CREATE TABLE IF NOT EXISTS connected_banks (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      provider TEXT DEFAULT 'enable_banking' NOT NULL,
      institution_id TEXT NOT NULL,
      institution_name TEXT NOT NULL,
      institution_logo TEXT,
      encrypted_access_token TEXT NOT NULL,
      encrypted_refresh_token TEXT,
      consent_id TEXT NOT NULL,
      consent_expires_at TEXT NOT NULL,
      last_synced_at TEXT,
      status TEXT DEFAULT 'active' NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_connected_banks_user ON connected_banks(user_id, status);

    CREATE TABLE IF NOT EXISTS bank_accounts (
      id TEXT PRIMARY KEY NOT NULL,
      connected_bank_id TEXT REFERENCES connected_banks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      account_external_id TEXT NOT NULL,
      iban_masked TEXT,
      account_name TEXT NOT NULL,
      account_type TEXT DEFAULT 'checking' NOT NULL,
      currency TEXT DEFAULT 'EUR' NOT NULL,
      balance_cents INTEGER,
      credit_limit_cents INTEGER,
      billing_day_of_month INTEGER,
      notes TEXT,
      auto_roundup_transfer INTEGER DEFAULT 0 NOT NULL,
      auto_roundup_pattern TEXT,
      auto_sync INTEGER DEFAULT 1 NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON bank_accounts(user_id, connected_bank_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_ext ON bank_accounts(connected_bank_id, account_external_id);

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      type TEXT DEFAULT 'expense' NOT NULL,
      cost_type TEXT DEFAULT 'variable' NOT NULL,
      amount_cents INTEGER NOT NULL,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      merchant TEXT,
      payment_method TEXT DEFAULT 'apple_pay' NOT NULL,
      receipt_path TEXT,
      recurring_id TEXT REFERENCES recurring_expenses(id) ON DELETE SET NULL,
      preset_id TEXT REFERENCES variable_presets(id) ON DELETE SET NULL,
      bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL,
      bank_transaction_id TEXT,
      client_temp_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON transactions(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_transactions_user_cat_date ON transactions(user_id, category_id, date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_recurring_due ON transactions(recurring_id, date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_client_temp ON transactions(user_id, client_temp_id);

    CREATE TABLE IF NOT EXISTS budgets (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      category_id TEXT REFERENCES categories(id) ON DELETE CASCADE,
      amount_cents INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_budgets_user_category ON budgets(user_id, category_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      id TEXT PRIMARY KEY NOT NULL DEFAULT 'global',
      app_name TEXT DEFAULT 'Cashflow' NOT NULL,
      app_subtitle TEXT DEFAULT 'Fixkosten & Variable Ausgaben' NOT NULL,
      primary_color TEXT DEFAULT '#2563eb' NOT NULL,
      allow_open_registration INTEGER DEFAULT 0 NOT NULL,
      default_payment_method TEXT DEFAULT 'apple_pay' NOT NULL,
      max_upload_size_mb INTEGER DEFAULT 15 NOT NULL,
      system_announcement TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS savings_goals (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      target_amount_cents INTEGER NOT NULL,
      current_amount_cents INTEGER DEFAULT 0 NOT NULL,
      target_date TEXT,
      icon TEXT DEFAULT 'piggy-bank',
      color TEXT DEFAULT '#10b981',
      is_archived INTEGER DEFAULT 0 NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_savings_goals_user ON savings_goals(user_id, is_archived);

    CREATE TABLE IF NOT EXISTS category_rules (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
      name TEXT,
      pattern TEXT NOT NULL,
      match_field TEXT DEFAULT 'all' NOT NULL,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      cost_type TEXT DEFAULT 'variable',
      priority INTEGER DEFAULT 0 NOT NULL,
      is_active INTEGER DEFAULT 1 NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_category_rules_user ON category_rules(user_id, is_active);
  `);

  // Sicherstellen, dass Bankkonten-Spalten bei bestehenden Datenbanken nachgezogen werden
  try {
    const bankAccCols = sqlite
      .prepare("PRAGMA table_info(bank_accounts)")
      .all() as { name: string; notnull: number }[];
    if (!bankAccCols.some((c) => c.name === "credit_limit_cents")) {
      sqlite.exec("ALTER TABLE bank_accounts ADD COLUMN credit_limit_cents INTEGER;");
    }
    if (!bankAccCols.some((c) => c.name === "billing_day_of_month")) {
      sqlite.exec("ALTER TABLE bank_accounts ADD COLUMN billing_day_of_month INTEGER;");
    }
    if (!bankAccCols.some((c) => c.name === "notes")) {
      sqlite.exec("ALTER TABLE bank_accounts ADD COLUMN notes TEXT;");
    }
    if (!bankAccCols.some((c) => c.name === "auto_roundup_transfer")) {
      sqlite.exec("ALTER TABLE bank_accounts ADD COLUMN auto_roundup_transfer INTEGER DEFAULT 0 NOT NULL;");
    }
    if (!bankAccCols.some((c) => c.name === "auto_roundup_pattern")) {
      sqlite.exec("ALTER TABLE bank_accounts ADD COLUMN auto_roundup_pattern TEXT;");
    }
    const connCol = bankAccCols.find((c) => c.name === "connected_bank_id");
    if (connCol && connCol.notnull === 1) {
      sqlite.exec(`
        PRAGMA foreign_keys=OFF;
        CREATE TABLE IF NOT EXISTS bank_accounts_migration_temp (
          id TEXT PRIMARY KEY NOT NULL,
          connected_bank_id TEXT REFERENCES connected_banks(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          account_external_id TEXT NOT NULL,
          iban_masked TEXT,
          account_name TEXT NOT NULL,
          account_type TEXT DEFAULT 'checking' NOT NULL,
          currency TEXT DEFAULT 'EUR' NOT NULL,
          balance_cents INTEGER,
          credit_limit_cents INTEGER,
          billing_day_of_month INTEGER,
          notes TEXT,
          auto_sync INTEGER DEFAULT 1 NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO bank_accounts_migration_temp (
          id, connected_bank_id, user_id, account_external_id, iban_masked,
          account_name, account_type, currency, balance_cents,
          credit_limit_cents, billing_day_of_month, notes,
          auto_sync, created_at, updated_at
        )
        SELECT
          id, connected_bank_id, user_id, account_external_id, iban_masked,
          account_name, account_type, currency, balance_cents,
          credit_limit_cents, billing_day_of_month, notes,
          auto_sync, created_at, updated_at
        FROM bank_accounts;
        DROP TABLE bank_accounts;
        ALTER TABLE bank_accounts_migration_temp RENAME TO bank_accounts;
        CREATE INDEX IF NOT EXISTS idx_bank_accounts_user ON bank_accounts(user_id, connected_bank_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_accounts_ext ON bank_accounts(connected_bank_id, account_external_id);
        PRAGMA foreign_keys=ON;
      `);
    }
  } catch {
    // Konkurrierender Next.js Worker hat Spalten bereits hinzugefügt
  }

  const userCols = sqlite.prepare("PRAGMA table_info(user)").all() as {
    name: string;
  }[];
  if (!userCols.some((c) => c.name === "banned")) {
    sqlite.exec("ALTER TABLE user ADD COLUMN banned INTEGER DEFAULT 0 NOT NULL;");
  }
  if (!userCols.some((c) => c.name === "two_factor_enabled")) {
    sqlite.exec(
      "ALTER TABLE user ADD COLUMN two_factor_enabled INTEGER DEFAULT 0 NOT NULL;"
    );
  }

  const settingsCols = sqlite
    .prepare("PRAGMA table_info(app_settings)")
    .all() as { name: string }[];
  if (!settingsCols.some((c) => c.name === "custom_logo_path")) {
    sqlite.exec("ALTER TABLE app_settings ADD COLUMN custom_logo_path TEXT;");
  }

  const tfCols = sqlite.prepare("PRAGMA table_info(two_factor)").all() as {
    name: string;
  }[];
  if (!tfCols.some((c) => c.name === "verified")) {
    sqlite.exec("ALTER TABLE two_factor ADD COLUMN verified INTEGER DEFAULT 0;");
  }
  if (!tfCols.some((c) => c.name === "failed_verification_count")) {
    sqlite.exec(
      "ALTER TABLE two_factor ADD COLUMN failed_verification_count INTEGER DEFAULT 0;"
    );
  }
  if (!tfCols.some((c) => c.name === "locked_until")) {
    sqlite.exec("ALTER TABLE two_factor ADD COLUMN locked_until INTEGER;");
  }

  const catCols = sqlite
    .prepare("PRAGMA table_info(categories)")
    .all() as { name: string }[];
  if (!catCols.some((c) => c.name === "parent_id")) {
    sqlite.exec("ALTER TABLE categories ADD COLUMN parent_id TEXT;");
  }

  // Sync-Steuerung pro Bankkonto (PSD2-Tageslimit, Backoff nach Fehlern)
  const syncCols = sqlite
    .prepare("PRAGMA table_info(bank_accounts)")
    .all() as { name: string }[];
  const syncColumnDdl: Record<string, string> = {
    unattended_sync_day: "TEXT",
    unattended_sync_count: "INTEGER DEFAULT 0 NOT NULL",
    sync_failure_count: "INTEGER DEFAULT 0 NOT NULL",
    sync_backoff_until: "INTEGER",
    last_sync_error: "TEXT",
  };
  for (const [col, ddl] of Object.entries(syncColumnDdl)) {
    if (!syncCols.some((c) => c.name === col)) {
      sqlite.exec(`ALTER TABLE bank_accounts ADD COLUMN ${col} ${ddl};`);
    }
  }

  // Sicherstellen, dass Bank-Sync-Spalten bei bestehenden Datenbanken nachgezogen werden
  const txCols = sqlite
    .prepare("PRAGMA table_info(transactions)")
    .all() as { name: string }[];
  if (!txCols.some((c) => c.name === "bank_account_id")) {
    sqlite.exec(
      "ALTER TABLE transactions ADD COLUMN bank_account_id TEXT REFERENCES bank_accounts(id) ON DELETE SET NULL;"
    );
  }
  if (!txCols.some((c) => c.name === "bank_transaction_id")) {
    sqlite.exec("ALTER TABLE transactions ADD COLUMN bank_transaction_id TEXT;");
  }
  if (!txCols.some((c) => c.name === "is_split")) {
    sqlite.exec("ALTER TABLE transactions ADD COLUMN is_split INTEGER DEFAULT 0 NOT NULL;");
  }
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_transactions_bank ON transactions(user_id, bank_account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_bank_tx ON transactions(bank_account_id, bank_transaction_id);

    CREATE TABLE IF NOT EXISTS transaction_splits (
      id TEXT PRIMARY KEY NOT NULL,
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
      amount_cents INTEGER NOT NULL,
      description TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_splits_tx ON transaction_splits(transaction_id);
  `);

  // Standard-Eintrag für globale App-Einstellungen anlegen (und alten Default 'Kostenmanager' auf 'Cashflow' migrieren)
  sqlite.exec(`
    INSERT OR IGNORE INTO app_settings (
      id, app_name, app_subtitle, primary_color, allow_open_registration, default_payment_method, max_upload_size_mb, updated_at
    ) VALUES (
      'global', 'Cashflow', 'Fixkosten & Variable Ausgaben', '#2563eb', 0, 'apple_pay', 15, ${Date.now()}
    );
    UPDATE app_settings SET app_name = 'Cashflow' WHERE id = 'global' AND app_name = 'Kostenmanager';
  `);
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "baseline",
    transactional: false,
    up: applyBaselineSchema,
  },
  {
    id: 2,
    name: "rate_limit",
    up: (sqlite) => {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS rate_limit (
          id TEXT PRIMARY KEY NOT NULL,
          key TEXT NOT NULL UNIQUE,
          count INTEGER NOT NULL,
          last_request INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: 3,
    name: "audit_log",
    up: (sqlite) => {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id TEXT PRIMARY KEY NOT NULL,
          created_at INTEGER NOT NULL,
          user_id TEXT,
          actor_id TEXT,
          action TEXT NOT NULL,
          target TEXT,
          ip_address TEXT,
          user_agent TEXT,
          details TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at);
      `);
    },
  },
  {
    id: 4,
    name: "job_locks",
    up: (sqlite) => {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS job_locks (
          name TEXT PRIMARY KEY NOT NULL,
          owner TEXT NOT NULL,
          locked_until INTEGER NOT NULL
        );
      `);
    },
  },
  {
    id: 5,
    name: "p3_finance_features",
    up: (sqlite) => {
      const txCols = (sqlite.prepare("PRAGMA table_info(transactions)").all() as { name: string }[]).map(
        (c) => c.name
      );
      if (!txCols.includes("review_status")) {
        // NULL = geprüft/manuell erfasst, 'pending' = importiert und noch nicht bestätigt
        sqlite.exec("ALTER TABLE transactions ADD COLUMN review_status TEXT;");
      }
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_transactions_review ON transactions(user_id, review_status);

        CREATE TABLE IF NOT EXISTS subscription_dismissals (
          user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          merchant_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, merchant_key)
        );

        CREATE TABLE IF NOT EXISTS balance_snapshots (
          user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          date TEXT NOT NULL,
          liquid_cents INTEGER NOT NULL,
          savings_cents INTEGER NOT NULL,
          debt_cents INTEGER NOT NULL,
          net_worth_cents INTEGER NOT NULL,
          PRIMARY KEY (user_id, date)
        );

        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          user_agent TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

        CREATE TABLE IF NOT EXISTS notification_settings (
          user_id TEXT PRIMARY KEY NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          budget_alerts INTEGER DEFAULT 1 NOT NULL,
          consent_alerts INTEGER DEFAULT 1 NOT NULL,
          large_tx_alerts INTEGER DEFAULT 1 NOT NULL,
          large_tx_threshold_cents INTEGER DEFAULT 50000 NOT NULL,
          inbox_alerts INTEGER DEFAULT 1 NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notification_log (
          user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          dedupe_key TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, dedupe_key)
        );

        CREATE TABLE IF NOT EXISTS app_secrets (
          name TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
    },
  },
  {
    // ID 7, damit sie unabhängig von Migration 6 (Logik-Korrekturen) zusammengeführt werden kann
    id: 7,
    name: "password_recovery",
    up: (sqlite) => {
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          token_hash TEXT NOT NULL UNIQUE,
          purpose TEXT NOT NULL,
          created_by TEXT,
          expires_at INTEGER NOT NULL,
          used_at INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);

        CREATE TABLE IF NOT EXISTS recovery_codes (
          id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          code_hash TEXT NOT NULL,
          used_at INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id);
      `);
    },
  },
  {
    id: 6,
    name: "fix_default_rules_and_legacy_cards",
    up: (sqlite) => {
      // 1. Standardregeln: ungültiges matchField "any" → "all"
      sqlite.exec("UPDATE category_rules SET match_field = 'all' WHERE match_field = 'any';");

      // 2. Fehlerhafte Standardmuster (Regex-Syntax bzw. zu kurze Begriffe) ersetzen
      const replacements: Array<[string, string]> = [
        [
          "bäckerei|baeckerei|konditorei|metzgerei|fleischerei|backwerk|ihle|kamp|kamps",
          "bäckerei|baeckerei|konditorei|metzgerei|fleischerei|backwerk|ihle backstube|kamps",
        ],
        [
          "netflix|spotify|disney plus|disney\\+|amazon prime|apple.com/bill|youtube premium|dazn|sky|wow|deezer|audible",
          "netflix|spotify|disney plus|disney+|amazon prime|apple.com/bill|youtube premium|dazn|sky deutschland|wow tv|deezer|audible",
        ],
        [
          "telekom|vodafone|o2|telefonica|1&1|congstar|freenet|fraenk|simon mobile",
          "telekom|vodafone|o2 germany|telefonica|1&1|congstar|freenet|fraenk|simon mobile",
        ],
        [
          "amazon|otto|zalando|mediamarkt|saturn|apple store|ikea|action|tedi",
          "amazon|otto gmbh|otto.de|zalando|mediamarkt|saturn|apple store|ikea|action gmbh|tedi",
        ],
        [
          "paypal.*lastschrift|paypal europe|paypal abbuchung",
          "paypal europe|paypal (europe)|paypal lastschrift|paypal abbuchung",
        ],
        [
          "kreditkartenabrechnung|kartenausgleich|umbuchung|übertrag eigenes konto",
          "kreditkartenabrechnung|kartenausgleich|übertrag eigenes konto|umbuchung eigenes konto",
        ],
      ];
      const update = sqlite.prepare("UPDATE category_rules SET pattern = ? WHERE pattern = ?");
      for (const [oldPattern, newPattern] of replacements) update.run(newPattern, oldPattern);

      // 3. PayPal-als-Umbuchung nur aktiv lassen, wenn ein PayPal-Konto geführt wird
      sqlite
        .prepare(
          `UPDATE category_rules
             SET is_active = 0, name = 'PayPal-Abbuchung als Umbuchung (nur mit PayPal-Konto)'
           WHERE pattern = ?
             AND user_id NOT IN (SELECT user_id FROM bank_accounts WHERE account_type = 'paypal')`
        )
        .run("paypal europe|paypal (europe)|paypal lastschrift|paypal abbuchung");

      // 4. Kreditkarten aus der Zeit vor v1.6.1 speicherten Limit und Saldo vertauscht
      //    (Saldo = verfügbarer Betrag, Limit = Schulden). Bisher wurde das nur in der
      //    Anzeige umgerechnet; jetzt einmalig in den Daten korrigiert.
      sqlite.exec(`
        UPDATE bank_accounts
           SET credit_limit_cents = credit_limit_cents + balance_cents,
               balance_cents = -credit_limit_cents
         WHERE account_type = 'credit_card'
           AND connected_bank_id IS NULL
           AND balance_cents > 0
           AND credit_limit_cents > 0
           AND created_at < 1795367682;
      `);
    },
  },
  {
    // ID 8: unabhängig von Migration 7 (Passwort-Wiederherstellung) zusammenführbar
    id: 8,
    name: "replace_roundup_with_rule",
    up: (sqlite) => {
      // Das „Kleingeld Plus“-Sparen wurde durch die allgemeine Umbuchungs-Erkennung
      // ersetzt. Wer es aktiv hatte, bekommt eine Regel, damit Aufrundungsbeträge
      // weiterhin als Umbuchung (nicht als Ausgabe) zählen.
      sqlite.exec(`
        INSERT INTO category_rules
          (id, user_id, name, pattern, match_field, category_id, cost_type, priority, is_active, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), u.user_id, 'Kleingeld- & Aufrundungssparen',
               'kleingeld plus|kleingeldplus|aufrundungssparen|aufrundung sparen', 'all', c.id, 'transfer', 86, 1,
               CAST(strftime('%s','now') AS INTEGER), CAST(strftime('%s','now') AS INTEGER)
          FROM (SELECT DISTINCT user_id FROM bank_accounts WHERE auto_roundup_transfer = 1) u
          JOIN categories c ON c.user_id = u.user_id AND c.name = 'Umbuchung & Ausgleich'
         WHERE NOT EXISTS (
           SELECT 1 FROM category_rules r
            WHERE r.user_id = u.user_id
              AND r.pattern = 'kleingeld plus|kleingeldplus|aufrundungssparen|aufrundung sparen'
         );
        UPDATE bank_accounts SET auto_roundup_transfer = 0 WHERE auto_roundup_transfer = 1;
      `);
    },
  },
  {
    id: 9,
    name: "default_payment_card",
    up: (sqlite) => {
      // Die Grund-Migration legt die Einstellung mit „Apple Pay“ an; Standard ist
      // künftig „Karte“. Die Einstellung wurde bisher nirgends verwendet,
      // vorhandene Werte sind also nur der alte Vorgabewert.
      sqlite.exec(
        "UPDATE app_settings SET default_payment_method = 'card' WHERE id = 'global' AND default_payment_method = 'apple_pay';"
      );
    },
  },
];

/**
 * Führt alle noch nicht angewendeten Migrationen in Reihenfolge aus.
 * Gibt die IDs der neu angewendeten Migrationen zurück.
 */
export function runMigrations(sqlite: Sqlite, migrations: Migration[] = MIGRATIONS): number[] {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  const applied = new Set(
    (sqlite.prepare("SELECT id FROM schema_migrations").all() as { id: number }[]).map(
      (r) => r.id
    )
  );
  const record = sqlite.prepare(
    "INSERT OR IGNORE INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)"
  );

  const newlyApplied: number[] = [];
  for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
    if (applied.has(migration.id)) continue;

    if (migration.transactional === false) {
      migration.up(sqlite);
      record.run(migration.id, migration.name, Date.now());
    } else {
      sqlite.transaction(() => {
        migration.up(sqlite);
        record.run(migration.id, migration.name, Date.now());
      })();
    }
    newlyApplied.push(migration.id);
  }
  return newlyApplied;
}
