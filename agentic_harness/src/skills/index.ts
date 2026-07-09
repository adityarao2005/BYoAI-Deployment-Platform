import { loadConfigIfAvailable } from "@/config/config"
import { registerZipSkillRepositories } from "./zip_skill_repo"
import { registerGitSkillRepositories } from "./git_skill_repo"

export * from "./skills"

const config = await loadConfigIfAvailable()

if (config) {
    registerZipSkillRepositories(config)
    registerGitSkillRepositories(config)
}