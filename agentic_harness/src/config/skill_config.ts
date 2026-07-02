import z from "zod";

// skill repository schema
export const SkillRepositoryConfigSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("zip"),
        location: z.string(),
        skillsSubdirectory: z.string().default("./"), // skills would be under root
        // // Optional headers for authentication if hitting a private file server
        headers: z.record(z.string(), z.string()).optional(),
    }),
    z.object({
        type: z.literal("git"),
        branch: z.string().default("main"),
        url: z.string(),
        auth: z.discriminatedUnion("method", [
            z.object({
                method: z.literal("ssh"),
                privateKeyPath: z.string().default(() => process.env.GIT_SSH_KEY_PATH || "~/.ssh/id_ed25519"),
            }),
            z.object({
                method: z.literal("token"),
                token: z.string().default(() => process.env.GIT_TOKEN || ""),
            }),
            z.object({
                method: z.literal("none"),
            })
        ]).default({ method: "none" }), // default to no auth
    })
]);

export type SkillRepositoryConfig = z.infer<typeof SkillRepositoryConfigSchema>;