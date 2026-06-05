# Decision: Cross-agent bootstrap bằng một dòng inject

**Status:** Approved  
**Date:** 2026-06-05

---

## Quyết định

`smem install` tự động inject một dòng vào file `.md` config/memory của từng agent:

```
Dự án này dùng **smem** để quản lý persistent memory dùng chung giữa các agent — gọi `smem.guide()` để xem hướng dẫn sử dụng.
```

Agent đọc config → thấy dòng này → gọi `smem.guide()` → self-onboard hoàn toàn.

---

## Vì sao một dòng là đủ

Không cần inject toàn bộ hướng dẫn vào config file vì:
- Config file dài → agent phải xử lý nhiều token hơn mỗi session
- Hướng dẫn có thể thay đổi khi smem update — nếu hardcode vào config thì outdated
- `smem.guide()` trả về hướng dẫn từ `agent-guide.yml` — luôn up-to-date

Một dòng ngắn đủ để: (1) agent biết smem tồn tại, (2) biết cách tự onboard.

---

## Target file theo từng agent

| Agent | File inject |
|---|---|
| Claude Code | `CLAUDE.md` hoặc `.claude/CLAUDE.md` |
| Cursor | `.cursorrules` |
| Codex (OpenAI) | `AGENTS.md` |
| Gemini CLI | `.gemini/config.md` hoặc tương đương |
| Windsurf | `.windsurfrules` |
| Bất kỳ agent nào | File memory/config mà agent đọc khi start |

`smem install` auto-detect agent đang dùng và inject vào đúng file.  
`smem install --agent cursor` để chỉ định explicit.

---

## Cross-agent là mục tiêu cốt lõi

Mọi agent đều dùng chung một memory store — không phải mỗi agent một kho riêng.  
Khi user switch từ Claude Code sang Cursor giữa chừng:
- Cursor đọc `.cursorrules` → thấy dòng smem → gọi `smem.guide()` → hiểu cách dùng
- Gọi `smem.context()` → thấy đúng project memory đã có từ Claude Code
- Tiếp tục làm việc với đầy đủ context — không mất gì khi đổi agent

---

## Trade-off

**Mất:** Agent phải chủ động gọi `smem.guide()` lần đầu  
**Được:** Config file sạch (1 dòng), hướng dẫn luôn up-to-date, hoạt động với mọi agent
