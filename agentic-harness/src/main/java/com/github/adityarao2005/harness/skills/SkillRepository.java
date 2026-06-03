package com.github.adityarao2005.harness.skills;

import java.util.List;

/**
 * Repository interface for managing and retrieving skills. This interface
 * defines methods for accessing the collection of skills available in the
 * system. Implementations of this interface
 * will provide the logic for storing and retrieving skills, which can be used
 * by agents to perform various tasks.
 */
public interface SkillRepository {
    /**
     * Gets a list of all available skills in the repository.
     * 
     * @return
     */
    List<Skill> getAllSkills();
}
