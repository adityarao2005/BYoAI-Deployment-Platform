import {
    bigint,
    index,
    json,
    mysqlTable,
    serial,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/mysql-core";

export const byoaiAgentMemories = mysqlTable("byoai_agent_memories", {
    id: varchar("id", { length: 255 }).primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    userId: varchar("user_id", { length: 255 }).notNull(),
    mode: varchar("mode", { length: 64 }).notNull(),
    parentId: varchar("parent_id", { length: 255 }),
    computerId: varchar("computer_id", { length: 255 }),
    skillsPath: varchar("skills_path", { length: 1024 }),
    createdAt: timestamp("created_at").defaultNow(),
});

export const byoaiTranscripts = mysqlTable(
    "byoai_transcripts",
    {
        id: serial("id").primaryKey(),
        agentId: varchar("agent_id", { length: 255 })
            .notNull()
            .references(() => byoaiAgentMemories.id, { onDelete: "cascade" }),
        entry: json("entry").notNull(),
        createdAt: timestamp("created_at").defaultNow(),
    },
    (table) => [
        index("idx_mysql_byoai_transcripts_agent_id").on(table.agentId),
    ],
);

export const byoaiUserTokens = mysqlTable("byoai_user_tokens", {
    userId: varchar("user_id", { length: 255 }).primaryKey(),
    accessToken: text("access_token"),
    tokenType: varchar("token_type", { length: 64 }),
    expiresAt: bigint("expires_at", { mode: "number" }),
    extraHeaders: json("extra_headers"),
    updatedAt: timestamp("updated_at").defaultNow(),
});

export const byoaiComputerSessions = mysqlTable("byoai_computer_sessions", {
    key: varchar("key", { length: 512 }).primaryKey(),
    computerId: varchar("computer_id", { length: 255 }).notNull(),
    lifecycle: varchar("lifecycle", { length: 64 }).notNull(),
    skillsPath: varchar("skills_path", { length: 1024 }),
    createdAt: bigint("created_at", { mode: "number" }),
});
