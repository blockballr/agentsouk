// a vault agent runs a funded HireVault hire instead of a per-call task. the
// card declares that skill, so the shelf can offer the group without guessing
// from the agent's name, its category, or who owns it

interface SkillLike {
  id?: string
  name?: string
}

// the published cards use the underscore form and the first-party registry uses
// the hyphen, so both spell the same capability
const VAULT_SKILL = /^vault[-_]execution$/i

export function takesVault(skills: SkillLike[] | null | undefined): boolean {
  if (!Array.isArray(skills)) return false
  return skills.some((s) => VAULT_SKILL.test(((s.id && s.id.trim()) ? s.id : (s.name ?? '')).trim()))
}

export const VAULT_SKILL_ID = 'vault-execution'
