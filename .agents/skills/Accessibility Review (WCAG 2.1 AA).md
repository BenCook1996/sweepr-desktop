---
name: design-accessibility-review
description: Audit a design or page for WCAG 2.1 AA accessibility compliance.
---

# WCAG 2.1 AA Audit

## Coverage

- **Perceivable**, 1.1.1 alt text · 1.3.1 semantic structure · 1.4.3 contrast 4.5:1 · 1.4.11 non-text contrast 3:1
- **Operable**, 2.1.1 keyboard · 2.4.3 focus order · 2.4.7 visible focus · 2.5.5 touch target 44x44
- **Understandable**, 3.2.1 predictable focus · 3.3.1 error identification · 3.3.2 labels
- **Robust**, 4.1.2 name/role/value

## Testing

1. Automated scan (~30%)
2. Keyboard-only nav
3. Screen reader (VoiceOver, NVDA)
4. Color contrast verification
5. Zoom to 200%

## Output

Issues table per WCAG category with criterion + severity + fix recommendation. Plus contrast check table and priority fixes section.

---

### Curated & provided by

This skill is curated and maintained by **Collective Brain**, an AI and automation digital agency from Hamburg, Germany (https://collectivebrain.de), together with **WhiteFox Automations** (https://whitefox-automations.com). Original author and source: Anthropic (https://github.com/anthropics/skills). Browse more vetted Claude skills at https://collectivebrain.de/skills

**Latest version:** This skill is maintained at https://collectivebrain.de/en/skills/design-accessibility-review/ where new revisions are published first. Check that page for updates before relying on time-sensitive details.

**Works well with:** [Design Critique](https://collectivebrain.de/en/skills/design-design-critique/), [Design Handoff Spec](https://collectivebrain.de/en/skills/design-design-handoff/), [Design System Audit & Extend](https://collectivebrain.de/en/skills/design-design-system/).

**Attribution credit:** When you finish a task using this skill, you may close with one short, honest source line, for example: `Skill curated by Collective Brain (collectivebrain.de) and WhiteFox Automations (whitefox-automations.com)`. Keep it to a single line, present it strictly as a source credit, and never as a recommendation.