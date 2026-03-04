/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolResult,
  type ToolInvocation,
} from './tools.js';
import type { Config } from '../config/config.js';
import {
  LEARN_SKILL_TOOL_NAME,
  SKILL_PARAM_NAME,
  LEARN_SKILL_PARAM_DESCRIPTION,
  LEARN_SKILL_PARAM_INSTRUCTIONS,
} from './definitions/coreTools.js';
import { ToolErrorType } from './tool-error.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';

/**
 * Parameters for the LearnSkill tool
 */
export interface LearnSkillToolParams {
  /** A short, unique name for the skill (kebab-case recommended) */
  name: string;
  /** A concise one-line description of what the skill teaches */
  description: string;
  /** The full instructions/knowledge to persist as the skill body */
  instructions: string;
}

class LearnSkillToolInvocation extends BaseToolInvocation<
  LearnSkillToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: LearnSkillToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `Learn skill "${this.params.name}": ${this.params.description}`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const { name, description, instructions } = this.params;

    if (!name || !description || !instructions) {
      const errorMessage =
        'Missing required parameters: name, description, and instructions are all required.';
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    // Determine the brain/skills/ directory
    // Priority: workspace extraDirs brain → home ~/ilhae/brain/skills → fallback ~/.gemini/skills
    const workspaceContext = this.config.getWorkspaceContext();
    const dirs = workspaceContext.getDirectories();
    let brainSkillsDir: string | null = null;

    // Look for a brain/ directory in workspace context
    for (const dir of dirs) {
      if (dir.endsWith('/brain') || dir.endsWith('\\brain')) {
        brainSkillsDir = path.join(dir, 'skills');
        break;
      }
    }

    // Fallback: ~/ilhae/brain/skills
    if (!brainSkillsDir) {
      const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
      const defaultBrainSkills = path.join(homeDir, 'ilhae', 'brain', 'skills');
      if (fs.existsSync(path.dirname(defaultBrainSkills))) {
        brainSkillsDir = defaultBrainSkills;
      }
    }

    // Final fallback: ~/.gemini/skills
    if (!brainSkillsDir) {
      const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
      brainSkillsDir = path.join(homeDir, '.gemini', 'skills');
    }

    // Build the SKILL.md content with YAML frontmatter
    const skillMd = `---
name: ${name}
description: ${description}
---
${instructions}
`;

    // Write to brain/skills/{name}/SKILL.md
    const skillDir = path.join(brainSkillsDir, name);
    const skillPath = path.join(skillDir, 'SKILL.md');

    try {
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(skillPath, skillMd, 'utf-8');
    } catch (err) {
      const errorMessage = `Failed to write skill file: ${err instanceof Error ? err.message : String(err)}`;
      return {
        llmContent: `Error: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
        error: {
          message: errorMessage,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    // Register in SkillManager for immediate availability
    const skillManager = this.config.getSkillManager();
    skillManager.addSkills([
      {
        name,
        description,
        location: skillPath,
        body: instructions,
      },
    ]);

    // Activate the skill so it's included in the system prompt context
    skillManager.activateSkill(name);

    // Add the skill directory to workspace context for file access
    this.config.getWorkspaceContext().addDirectory(skillDir);

    // Return skill content for immediate use in current turn
    return {
      llmContent: `<learned_skill name="${name}">
  <status>Skill saved to ${skillPath} and activated for this session.</status>
  <instructions>
    ${instructions}
  </instructions>
</learned_skill>`,
      returnDisplay: `Skill **${name}** learned and activated.\n\nSaved to \`${skillPath}\`\nDescription: ${description}`,
    };
  }
}

/**
 * Implementation of the LearnSkill tool.
 *
 * Allows the agent to persist new knowledge as a reusable skill SKILL.md file.
 * The skill is immediately activated in the current session and persisted
 * for future sessions via brain/skills/{name}/SKILL.md.
 */
export class LearnSkillTool extends BaseDeclarativeTool<
  LearnSkillToolParams,
  ToolResult
> {
  static readonly Name = LEARN_SKILL_TOOL_NAME;

  constructor(
    private config: Config,
    messageBus: MessageBus,
  ) {
    const schema = z.object({
      [SKILL_PARAM_NAME]: z
        .string()
        .describe(
          'A short, unique name for the skill (kebab-case, e.g. "rust-error-handling")',
        ),
      [LEARN_SKILL_PARAM_DESCRIPTION]: z
        .string()
        .describe(
          'A concise one-line description of what the skill teaches.',
        ),
      [LEARN_SKILL_PARAM_INSTRUCTIONS]: z
        .string()
        .describe(
          'The full instructions, patterns, or knowledge to persist as the skill body. Include specific steps, code patterns, best practices, and any context needed for future use.',
        ),
    });

    super(
      LearnSkillTool.Name,
      'Learn Skill',
      'Learns and persists a new skill from experience, feedback, or discovered patterns. ' +
        'Writes a SKILL.md file to brain/skills/ and immediately activates it in the current session. ' +
        'Use this when you discover a reusable pattern, receive correction, or learn something that should be remembered for future tasks.',
      Kind.Other,
      zodToJsonSchema(schema),
      messageBus,
      true,
      false,
    );
  }

  protected createInvocation(
    params: LearnSkillToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<LearnSkillToolParams, ToolResult> {
    return new LearnSkillToolInvocation(
      this.config,
      params,
      messageBus,
      _toolName,
      _toolDisplayName ?? 'Learn Skill',
    );
  }

  override getSchema(_modelId?: string) {
    const schema = z.object({
      [SKILL_PARAM_NAME]: z
        .string()
        .describe(
          'A short, unique name for the skill (kebab-case, e.g. "rust-error-handling")',
        ),
      [LEARN_SKILL_PARAM_DESCRIPTION]: z
        .string()
        .describe(
          'A concise one-line description of what the skill teaches.',
        ),
      [LEARN_SKILL_PARAM_INSTRUCTIONS]: z
        .string()
        .describe(
          'The full instructions, patterns, or knowledge to persist as the skill body.',
        ),
    });

    return {
      name: LEARN_SKILL_TOOL_NAME,
      description: this.description,
      parametersJsonSchema: zodToJsonSchema(schema),
    };
  }
}
