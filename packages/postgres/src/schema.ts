import { pgTable, text, bigint, serial, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const byoaiAgentMemories = pgTable("byoai_agent_memories", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    userId: text("user_id").notNull(),
    mode: text("mode").notNull(),
    parentId: text("parent_id"),
    computerId: text("computer_id"),
    skillsPath: text("skills_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const byoaiTranscripts = pgTable(
    "byoai_transcripts",
    {
        id: serial("id").primaryKey(),
        agentId: text("agent_id")
            .notNull()
            .references(() => byoaiAgentMemories.id, { onDelete: "cascade" }),
        entry: jsonb("entry").notNull(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    },
    (table) => [
        index("idx_byoai_transcripts_agent_id").on(table.agentId),
    ],
);

export const byoaiUserTokens = pgTable("byoai_user_tokens", {
    userId: text("user_id").primaryKey(),
    accessToken: text("access_token"),
    tokenType: text("token_type"),
    expiresAt: bigint("expires_at", { mode: "number" }),
    extraHeaders: jsonb("extra_headers"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const byoaiComputerSessions = pgTable("byoai_computer_sessions", {
    key: text("key").primaryKey(),
    computerId: text("computer_id").notNull(),
    lifecycle: text("lifecycle").notNull(),
    skillsPath: text("skills_path"),
    createdAt: bigint("created_at", { mode: "number" }),
});
