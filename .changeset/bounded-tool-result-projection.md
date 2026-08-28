---
"@nestm/mcp-conformance": minor
---

Added a bounded, lossy `tools/call` result projection. Text stays text under per-block and shared
UTF-8 budgets, non-text blocks become descriptor-only summaries, and structured content is rebuilt
as frozen null-prototype JSON under fixed hard ceilings. Hostile or unrepresentable values are
dropped without invoking getters and make the immutable result explicitly `truncated`.
