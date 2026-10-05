import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const byoaiAgentMemories = sqliteTable("byoai_agent_memories", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    userId: text("user_id").notNull(),
    mode: text("mode").notNull(),
    parentId: text("parent_id"),
    computerId: text("computer_id"),
    skillsPath: text("skills_path"),
    createdAt: integer("created_at").$defaultFn(() => Date.now()),
});

export const byoaiTranscripts = sqliteTable(
    "byoai_transcripts",
    {
        id: integer("id").primaryKey({ autoIncrement: true }),
        agentId: text("agent_id")
            .notNull()
            .references(() => byoaiAgentMemories.id, { onDelete: "cascade" }),
        entry: text("entry", { mode: "json" }).notNull(),
        createdAt: integer("created_at").$defaultFn(() => Date.now()),
    },
    (table) => [
        index("idx_sqlite_byoai_transcripts_agent_id").on(table.agentId),
    ],
);

export const byoaiUserTokens = sqliteTable("byoai_user_tokens", {
    userId: text("user_id").primaryKey(),
    accessToken: text("access_token"),
    tokenType: text("token_type"),
    expiresAt: integer("expires_at"),
    extraHeaders: text("extra_headers", { mode: "json" }),
    updatedAt: integer("updated_at").$defaultFn(() => Date.now()),
});

export const byoaiComputerSessions = sqliteTable("byoai_computer_sessions", {
    key: text("key").primaryKey(),
    computerId: text("computer_id").notNull(),
    lifecycle: text("lifecycle").notNull(),
    skillsPath: text("skills_path"),
    createdAt: integer("created_at").$defaultFn(() => Date.now()),
});
