import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// ==========================================
// 1. BETTER AUTH TABELLEN
// ==========================================

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  role: text("role", { enum: ["admin", "user"] })
    .notNull()
    .default("user"),
  banned: integer("banned", { mode: "boolean" }).notNull().default(false),
  twoFactorEnabled: integer("two_factor_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: integer("access_token_expires_at", {
    mode: "timestamp",
  }),
  refreshTokenExpiresAt: integer("refresh_token_expires_at", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  password: text("password"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
});

export const twoFactor = sqliteTable("two_factor", {
  id: text("id").primaryKey(),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: integer("verified", { mode: "boolean" }).default(false),
  failedVerificationCount: integer("failed_verification_count").default(0),
  lockedUntil: integer("locked_until", { mode: "timestamp" }),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const passkey = sqliteTable("passkey", {
  id: text("id").primaryKey(),
  name: text("name"),
  publicKey: text("public_key").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  credentialID: text("credential_id").notNull(),
  counter: integer("counter").notNull(),
  deviceType: text("device_type").notNull(),
  backedUp: integer("backed_up", { mode: "boolean" }).notNull(),
  transports: text("transports"),
  createdAt: integer("created_at", { mode: "timestamp" }),
  aaguid: text("aaguid"),
});

// Rate-Limiting von Better Auth (storage: "database")
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

// Protokoll sicherheitsrelevanter Aktionen (bewusst ohne Fremdschlüssel,
// damit Einträge auch nach dem Löschen eines Benutzers erhalten bleiben)
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    userId: text("user_id"),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    target: text("target"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    details: text("details"),
  },
  (table) => [
    index("idx_audit_log_created").on(table.createdAt),
    index("idx_audit_log_user").on(table.userId, table.createdAt),
  ]
);

// Verteilte Sperren für Hintergrundjobs (verhindert parallele Läufe)
export const jobLocks = sqliteTable("job_locks", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  lockedUntil: integer("locked_until").notNull(),
});

// ==========================================
// 2. ADMIN EINLADUNGEN
// ==========================================

export const invitations = sqliteTable("invitations", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email"), // Optional an eine bestimmte E-Mail gebunden
  createdBy: text("created_by")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  usedBy: text("used_by").references(() => user.id, { onDelete: "set null" }),
  usedAt: integer("used_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ==========================================
// 3. KATEGORIEN
// ==========================================

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: text("parent_id"), // Übergeordnete Kategorie für 2-stufige Hierarchie
    color: text("color").notNull().default("#3b82f6"),
    icon: text("icon").notNull().default("ShoppingCart"),
    type: text("type", { enum: ["expense", "income"] })
      .notNull()
      .default("expense"),
    sortOrder: integer("sort_order").notNull().default(0),
    isDefault: integer("is_default", { mode: "boolean" })
      .notNull()
      .default(false),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_categories_user").on(table.userId, table.isArchived)]
);

// ==========================================
// 4. FIXKOSTEN / WIEDERKEHRENDE KOSTEN
// ==========================================

export const PAYMENT_METHODS = [
  "apple_pay",
  "card",
  "cash",
  "direct_debit",
  "transfer",
  "paypal",
  "other",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const INTERVALS = [
  "weekly",
  "monthly",
  "quarterly",
  "half_yearly",
  "yearly",
] as const;

export type RecurringInterval = (typeof INTERVALS)[number];

export const recurringExpenses = sqliteTable(
  "recurring_expenses",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    type: text("type", { enum: ["expense", "income"] })
      .notNull()
      .default("expense"),
    name: text("name").notNull(), // z.B. "Miete Warm", "Netflix", "Fitnessstudio"
    description: text("description"),
    amountCents: integer("amount_cents").notNull(), // in EUR Cent
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS })
      .notNull()
      .default("direct_debit"),
    interval: text("interval", { enum: INTERVALS })
      .notNull()
      .default("monthly"),
    dayOfMonth: integer("day_of_month").notNull().default(1), // 1 - 31
    startDate: text("start_date").notNull(), // YYYY-MM-DD
    endDate: text("end_date"), // optional YYYY-MM-DD
    nextDueDate: text("next_due_date").notNull(), // YYYY-MM-DD
    lastProcessedDate: text("last_processed_date"), // YYYY-MM-DD
    autoBook: integer("auto_book", { mode: "boolean" })
      .notNull()
      .default(true),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_recurring_user_due").on(
      table.userId,
      table.active,
      table.nextDueDate
    ),
  ]
);

// ==========================================
// 5. VORDEFINIERTE VARIABLE KOSTEN (PRESETS)
// ==========================================

export const variablePresets = sqliteTable(
  "variable_presets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["expense", "income"] })
      .notNull()
      .default("expense"),
    name: text("name").notNull(), // z.B. "Bäcker / Kaffee", "Supermarkt Einkauf", "Tanken"
    defaultAmountCents: integer("default_amount_cents"), // Optional! Wenn null, tippt User nur noch den Betrag ein
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS })
      .notNull()
      .default("card"),
    usageCount: integer("usage_count").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_presets_user").on(table.userId, table.usageCount)]
);

// ==========================================
// 5b. BANK-SYNCHRONISATION (OPEN BANKING / PSD2)
// ==========================================

export const BANK_PROVIDERS = ["enable_banking", "gocardless"] as const;
export type BankProvider = (typeof BANK_PROVIDERS)[number];

export const BANK_ACCOUNT_TYPES = [
  "checking",
  "credit_card",
  "savings",
  "cash",
  "paypal",
] as const;
export type BankAccountType = (typeof BANK_ACCOUNT_TYPES)[number];

export const connectedBanks = sqliteTable(
  "connected_banks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: BANK_PROVIDERS })
      .notNull()
      .default("enable_banking"),
    institutionId: text("institution_id").notNull(), // z. B. "ING_DE", "SPARKASSE_DE", "C24_DE", "COMMERZBANK_DE"
    institutionName: text("institution_name").notNull(),
    institutionLogo: text("institution_logo"),
    encryptedAccessToken: text("encrypted_access_token").notNull(),
    encryptedRefreshToken: text("encrypted_refresh_token"),
    consentId: text("consent_id").notNull(),
    consentExpiresAt: text("consent_expires_at").notNull(), // ISO-8601 Datum
    lastSyncedAt: text("last_synced_at"),
    status: text("status", { enum: ["active", "expired", "revoked", "error"] })
      .notNull()
      .default("active"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_connected_banks_user").on(table.userId, table.status)]
);

export const bankAccounts = sqliteTable(
  "bank_accounts",
  {
    id: text("id").primaryKey(),
    connectedBankId: text("connected_bank_id")
      .references(() => connectedBanks.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountExternalId: text("account_external_id").notNull(),
    ibanMasked: text("iban_masked"), // z. B. "DE89 **** **** **** 1234" oder "**** 4321"
    accountName: text("account_name").notNull(),
    accountType: text("account_type", { enum: BANK_ACCOUNT_TYPES })
      .notNull()
      .default("checking"),
    currency: text("currency").notNull().default("EUR"),
    balanceCents: integer("balance_cents"),
    creditLimitCents: integer("credit_limit_cents"), // z. B. 250000 Cent = 2.500,00 € Kreditlimit
    billingDayOfMonth: integer("billing_day_of_month"), // z. B. 20 (am 20. des Monats Abrechnung)
    notes: text("notes"), // Optionale Notizen / Infos
    autoRoundupTransfer: integer("auto_roundup_transfer", { mode: "boolean" })
      .notNull()
      .default(false), // Automatisches Aufrundungssparen / Kleingeld Plus Ziel
    autoRoundupPattern: text("auto_roundup_pattern"), // Suchmuster z. B. "kleingeld|kleingeld plus|aufrundung"
    autoSync: integer("auto_sync", { mode: "boolean" }).notNull().default(true),
    // PSD2: Abrufe ohne Anwesenheit des Nutzers sind auf 4 pro Tag begrenzt
    unattendedSyncDay: text("unattended_sync_day"), // YYYY-MM-DD (UTC)
    unattendedSyncCount: integer("unattended_sync_count").notNull().default(0),
    syncFailureCount: integer("sync_failure_count").notNull().default(0),
    syncBackoffUntil: integer("sync_backoff_until", { mode: "timestamp_ms" }),
    lastSyncError: text("last_sync_error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_bank_accounts_user").on(table.userId, table.connectedBankId),
    uniqueIndex("idx_bank_accounts_ext").on(
      table.connectedBankId,
      table.accountExternalId
    ),
  ]
);

// ==========================================
// 6. TRANSAKTIONEN / EINTRÄGE
// ==========================================

export const transactions = sqliteTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    type: text("type", { enum: ["expense", "income"] })
      .notNull()
      .default("expense"),
    costType: text("cost_type", { enum: ["variable", "fixed", "transfer"] })
      .notNull()
      .default("variable"),
    amountCents: integer("amount_cents").notNull(), // Positiver Integer in Cent
    date: text("date").notNull(), // YYYY-MM-DD
    description: text("description").notNull(),
    merchant: text("merchant"), // Optionaler Händler / Empfänger
    paymentMethod: text("payment_method", { enum: PAYMENT_METHODS })
      .notNull()
      .default("card"),
    receiptPath: text("receipt_path"), // Relativer Dateiname unter /data/uploads
    recurringId: text("recurring_id").references(() => recurringExpenses.id, {
      onDelete: "set null",
    }),
    presetId: text("preset_id").references(() => variablePresets.id, {
      onDelete: "set null",
    }),
    bankAccountId: text("bank_account_id").references(() => bankAccounts.id, {
      onDelete: "set null",
    }),
    bankTransactionId: text("bank_transaction_id"),
    isSplit: integer("is_split", { mode: "boolean" }).notNull().default(false),
    clientTempId: text("client_temp_id"), // Für Offline-Sync Deduplizierung
    // null = geprüft/manuell erfasst, "pending" = importiert, wartet auf Prüfung (Inbox)
    reviewStatus: text("review_status", { enum: ["pending"] }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_transactions_user_date").on(table.userId, table.date),
    index("idx_transactions_user_cat_date").on(
      table.userId,
      table.categoryId,
      table.date
    ),
    uniqueIndex("idx_transactions_recurring_due").on(
      table.recurringId,
      table.date
    ),
    uniqueIndex("idx_transactions_client_temp").on(
      table.userId,
      table.clientTempId
    ),
    index("idx_transactions_bank").on(table.userId, table.bankAccountId),
    uniqueIndex("idx_transactions_bank_tx").on(
      table.bankAccountId,
      table.bankTransactionId
    ),
  ]
);

// ==========================================
// 6b. SPLIT-BUCHUNGEN (UNTERKATEGORIEN EINER BUCHUNG)
// ==========================================

export const transactionSplits = sqliteTable(
  "transaction_splits",
  {
    id: text("id").primaryKey(),
    transactionId: text("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    description: text("description"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_splits_tx").on(table.transactionId)]
);

// ==========================================
// 7. MONATSBUDGETS
// ==========================================

export const budgets = sqliteTable(
  "budgets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    categoryId: text("category_id").references(() => categories.id, {
      onDelete: "cascade",
    }), // Wenn null -> Gesamt-Monatsbudget für alle Kategorien
    amountCents: integer("amount_cents").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("idx_budgets_user_category").on(table.userId, table.categoryId),
  ]
);

// ==========================================
// 8. GLOBALE APP-EINSTELLUNGEN & BRANDING
// ==========================================

export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey().default("global"),
  appName: text("app_name").notNull().default("Cashflow"),
  appSubtitle: text("app_subtitle")
    .notNull()
    .default("Fixkosten & Variable Ausgaben"),
  primaryColor: text("primary_color").notNull().default("#2563eb"),
  allowOpenRegistration: integer("allow_open_registration", {
    mode: "boolean",
  })
    .notNull()
    .default(false),
  defaultPaymentMethod: text("default_payment_method", {
    enum: PAYMENT_METHODS,
  })
    .notNull()
    .default("card"),
  maxUploadSizeMb: integer("max_upload_size_mb").notNull().default(15),
  customLogoPath: text("custom_logo_path"),
  systemAnnouncement: text("system_announcement"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ==========================================
// 9. SPARZIELE & SINKING FUNDS (SPARTÖPFE)
// ==========================================

export const savingsGoals = sqliteTable(
  "savings_goals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    targetAmountCents: integer("target_amount_cents").notNull(), // Zielbetrag in Cent
    currentAmountCents: integer("current_amount_cents").notNull().default(0), // Bisher gespart in Cent
    targetDate: text("target_date"), // YYYY-MM-DD
    icon: text("icon").default("piggy-bank"),
    color: text("color").default("#10b981"),
    isArchived: integer("is_archived", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_savings_goals_user").on(table.userId, table.isArchived),
  ]
);

export type SavingsGoal = typeof savingsGoals.$inferSelect;

// ==========================================
// 10. AUTO-KATEGORISIERUNGS-REGELN
// ==========================================

export const MATCH_FIELDS = [
  "all",
  "merchant",
  "description",
  "remittance",
] as const;
export type MatchField = (typeof MATCH_FIELDS)[number];

export const categoryRules = sqliteTable(
  "category_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name"),
    pattern: text("pattern").notNull(),
    matchField: text("match_field", { enum: MATCH_FIELDS })
      .notNull()
      .default("all"),
    categoryId: text("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    costType: text("cost_type", { enum: ["variable", "fixed", "transfer"] })
      .default("variable"),
    priority: integer("priority").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("idx_category_rules_user").on(table.userId, table.isActive),
  ]
);

export type CategoryRule = typeof categoryRules.$inferSelect;


// ==========================================
// P3: ABO-ERKENNUNG, VERMÖGEN, BENACHRICHTIGUNGEN
// ==========================================

export const subscriptionDismissals = sqliteTable(
  "subscription_dismissals",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    merchantKey: text("merchant_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.merchantKey] })]
);

export const balanceSnapshots = sqliteTable(
  "balance_snapshots",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: text("date").notNull(), // YYYY-MM-DD
    liquidCents: integer("liquid_cents").notNull(),
    savingsCents: integer("savings_cents").notNull(),
    debtCents: integer("debt_cents").notNull(),
    netWorthCents: integer("net_worth_cents").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.date] })]
);

export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_push_subscriptions_user").on(table.userId)]
);

export const notificationSettings = sqliteTable("notification_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  budgetAlerts: integer("budget_alerts", { mode: "boolean" }).notNull().default(true),
  consentAlerts: integer("consent_alerts", { mode: "boolean" }).notNull().default(true),
  largeTxAlerts: integer("large_tx_alerts", { mode: "boolean" }).notNull().default(true),
  largeTxThresholdCents: integer("large_tx_threshold_cents").notNull().default(50000),
  inboxAlerts: integer("inbox_alerts", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const notificationLog = sqliteTable(
  "notification_log",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.dedupeKey] })]
);

export const appSecrets = sqliteTable("app_secrets", {
  name: text("name").primaryKey(),
  value: text("value").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

// ==========================================
// PASSWORT-WIEDERHERSTELLUNG (ohne E-Mail)
// ==========================================

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    purpose: text("purpose", { enum: ["admin_link", "cli"] }).notNull(),
    createdBy: text("created_by"),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_password_reset_user").on(table.userId)]
);

export const recoveryCodes = sqliteTable(
  "recovery_codes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("idx_recovery_codes_user").on(table.userId)]
);
