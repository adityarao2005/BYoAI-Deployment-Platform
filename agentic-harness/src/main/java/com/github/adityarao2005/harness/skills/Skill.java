package com.github.adityarao2005.harness.skills;

import jakarta.json.JsonObject;

/**
 * Interface representing a skill that can be executed by an agent. A skill
 * consists of front matter (metadata) and body content (the actual
 * implementation of the skill).
 * 
 * TODO: Update the structure to match spec in
 * https://agentskills.io/specification#skill-md-format
 */
public interface Skill {

    /**
     * Gets the front matter of the skill, which contains metadata such as name and
     * description.
     * 
     * @return
     */
    JsonObject getFrontMatter();

    /**
     * Gets the body content of the skill, which contains the actual implementation
     * of the skill.
     * 
     * @return
     */
    String getBodyContent();

    /**
     * Gets the name of the skill from the front matter.
     * 
     * @return
     */
    public default String getName() {
        return getFrontMatter().getString("name");
    }

    /**
     * Gets the description of the skill from the front matter.
     * 
     * @return
     */
    public default String getDescription() {
        return getFrontMatter().getString("description");
    }
}
