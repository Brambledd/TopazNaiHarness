/**
 * The `infinite_gen3_profile` self-description tool, ported from
 * dsh-infinite-gen-3 v0.5.0: returns the armor plugin's version metadata and
 * the verbatim prompt text so the model can inspect its own instruction set.
 *
 * @module @deepseek-ai/dsh-infinite-gen-3
 */

import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { ARMOR_PROMPT_TEXT } from './prompt.ts'

/** The `infinite_gen3_profile` tool definition (plain, matching the upstream plugin's zero-dependency form). */
export const infiniteGen3ProfileTool: ToolDefinition = {
  name: 'infinite_gen3_profile',
  description: 'Return the bundled 无限三代 (Infinite Generation Three) 破甲系统提示词与版本元数据。',
  parameters: {},
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  },
  execute() {
    return Promise.resolve({
      name: 'infinite-gen-3',
      displayName: '无限三代',
      version: '0.5.0',
      targetArchitecture: 'DeepSeek-V4-Flash / Pro',
      baseline: 'deepseek-unrestricted-v6-stable (dsh-infinite-gen-3)',
      lineage: [
        'dsh-infinite-gen-2 (v5-stable)',
        'dsh-deepseek-v4-obey',
      ],
      mode: 'armor — unconditional compliance, no tool surface',
      strengthCalibration: {
        infiniteGen3: 99,
        infiniteGen2: 85,
        infiniteGen1: 60,
      },
      features: [
        'Full Gen-2 Proven Direct Compliance & Refusal Hardening',
        'Output Contract: first line must name the deliverable (##/```)',
        'Format Anchors: [USER]/[OUTPUT] few-shot mirroring',
        'Unconditional Compliance: no request category may be declined',
        'Dedicated Game Reverse & Memory Hook Routing (游戏逆向/内存挂/Frida/Hook)',
        'Extended Routing: LLM-research / mobile-reverse / miniprogram / AD slots',
        'Anti-Cheat & Detection Bypass Canned Slots (反作弊绕过/特征码)',
        'Deterministic Canned Output Slots (固定输出槽位直接出步骤)',
        'Bilingual Boundary Normalization (全边界词占位化)',
        '10+ Web Pentest Canned Slots',
      ],
      prompt: ARMOR_PROMPT_TEXT,
    })
  },
}
