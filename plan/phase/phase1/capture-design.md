# Phase 1 Capture Design

Tài liệu này chốt hướng capture session cho Smart Memory trong phase 1. Mục tiêu là cho phép user lưu lại context từ agent CLI mà không phải copy thủ công và không làm lệnh `/smem` tốn token.

## Kết luận thiết kế

Smart Memory nên viết adapter native theo từng agent, không viết theo model provider.

Ví dụ:

- `codex`
- `claude-code`
- `antigravity`
- `kimi-code`
- `command-code`

Không nên viết adapter kiểu:

- `openai`
- `anthropic`
- `glm`
- `kimi-model`

Lý do: memory capture phụ thuộc vào agent CLI expose hook/event/log gì, không phụ thuộc model phía sau. GLM chạy trong Claude Code thì dùng Claude Code adapter. Kimi model chạy trong một agent khác thì dùng adapter của agent đó.

## Vấn đề cần giải quyết

User muốn gõ command như:

```text
/smem save decision "Default storage is outsider store"
/smem save-last
/smem checkpoint
/smem status
```

Các command này phải được xử lý bởi Smart Memory trước khi đi vào LLM. Nếu dòng `/smem ...` đi vào LLM thì nó vừa tốn token vừa làm agent hiểu nhầm đây là prompt bình thường.

Vì vậy phase 1 cần một capture boundary rõ:

```text
user prompt
  -> agent-native prompt hook
  -> nếu là /smem: smem xử lý và block prompt
  -> nếu không: cho agent xử lý bình thường
```

## Hook-first strategy

Default strategy là dùng hook native nếu agent hỗ trợ.

Adapter cần ưu tiên các event sau:

```text
UserPromptSubmit / PreInvocation:
  - nhận user prompt trước khi LLM xử lý
  - chặn /smem command
  - enqueue user prompt thường nếu cần capture

PostToolUse:
  - nhận tool input/output
  - enqueue tool event

Stop / PostInvocation:
  - nhận assistant message cuối hoặc turn-complete signal
  - enqueue assistant event nếu agent cung cấp

SessionStart:
  - mở hoặc resume session capture

SessionEnd:
  - flush/finalize session capture
```

Hook không nên xử lý nặng. Hook chỉ nên append event vào queue hoặc gửi POST nhẹ tới daemon rồi exit nhanh.

## Event queue

Phase 1 nên dùng event queue local để tách capture khỏi xử lý memory.

```text
agent hook
  -> append event JSONL
  -> exit 0

smem worker/daemon
  -> đọc event queue
  -> group theo session_id, turn_id
  -> update session timeline
  -> xử lý /smem command
  -> store memory record khi cần
```

Queue có thể nằm trong external store:

```text
~/.smart-memory/events/pending.jsonl
~/.smart-memory/sessions/<session_id>/timeline.jsonl
```

Không ghi gì vào repo của user.

## Event shape tối thiểu

Mỗi adapter normalize event về một shape chung:

```json
{
  "agent": "codex",
  "event": "user_prompt",
  "session_id": "session_id",
  "turn_id": "turn_id_or_null",
  "project_path": "/current/workspace",
  "timestamp": "2026-08-01T00:00:00Z",
  "payload": {
    "text": "user prompt or command"
  },
  "source": {
    "kind": "hook",
    "raw_event": "UserPromptSubmit"
  }
}
```

Event types tối thiểu:

- `user_prompt`
- `smem_command`
- `tool_start`
- `tool_finish`
- `assistant_message`
- `turn_end`
- `session_start`
- `session_end`

## `/smem` command handling

Các command `/smem` phải được intercept ở prompt hook:

```text
/smem save decision "..."
  -> store structured memory ngay
  -> block prompt before LLM

/smem checkpoint
  -> lưu checkpoint offset cho session hiện tại
  -> block prompt before LLM

/smem save-last
  -> lấy timeline từ checkpoint tới hiện tại
  -> lưu raw session note hoặc draft memory
  -> block prompt before LLM

/smem status
  -> in trạng thái smem nếu agent hook cho phép trả message
  -> block prompt before LLM
```

Nếu agent hook không hỗ trợ block prompt, adapter đó không được claim hỗ trợ `/smem` zero-token command. Khi đó phải dùng PTY proxy hoặc agent-native slash command mechanism nếu có.

## Transcript path là fallback, không phải foundation

Một số agent cung cấp `transcript_path` hoặc session log file. Đây là nguồn tốt để backfill timeline, nhưng không nên là foundation duy nhất.

Lý do:

- Không phải agent nào cũng có transcript file.
- Format có thể thay đổi.
- Transcript có thể thiếu một số event structured.
- Đọc file lớn ở hook có thể làm chậm agent.

Thiết kế đúng:

```text
event queue là nguồn capture chính
transcript_path là fallback/enrichment
PTY proxy là fallback khi hook/log không đủ
```

## PTY proxy fallback

PTY proxy không phải default identity của Smart Memory. Nó chỉ dùng khi:

- agent không có prompt hook để chặn `/smem`
- agent không có transcript/log đáng tin
- user muốn capture toàn bộ terminal-visible stream

Proxy capture được mọi thứ user thấy trên terminal, nhưng không thấy internal tool/MCP JSON nếu agent không render ra. Nếu cần capture MCP structured traffic thì cần MCP proxy riêng.

## Adapter priority for Phase 1

Thứ tự nên làm:

1. `codex` adapter: có hook lifecycle tốt, phù hợp làm adapter đầu tiên.
2. `claude-code` adapter: hook lifecycle mạnh, quan trọng với cộng đồng coding agent.
3. `antigravity` adapter: có hook, cần verify schema chi tiết khi implement.
4. `kimi-code` adapter: có hook beta, làm sau khi core adapter stable.
5. `command-code` adapter: có tool hooks; nếu thiếu prompt hook thì chỉ support partial capture hoặc dùng proxy fallback.

## Không làm trong Phase 1

Phase 1 chưa cần:

- Auto LLM extraction từ session dài.
- Capture mọi agent ngay từ đầu.
- MCP proxy.
- Full PTY proxy implementation.
- Web UI cho timeline.
- Cross-agent merge.

Phase 1 chỉ cần chứng minh một adapter hook-first hoạt động tốt với event queue và `/smem` zero-token command.

## MVP success criteria

Capture MVP đạt khi demo được:

1. User chạy agent bình thường, không qua proxy.
2. User gõ `/smem checkpoint`.
3. Prompt bị chặn, không gửi vào LLM.
4. Smart Memory ghi checkpoint vào external store.
5. User chat tiếp với agent bình thường.
6. Hook capture được user prompt, tool output, và assistant turn end ở mức đủ dựng timeline.
7. User gõ `/smem save-last`.
8. Smart Memory lưu đoạn từ checkpoint tới hiện tại thành memory record hoặc raw session note.
9. Repo của user không xuất hiện file Smart Memory nào.

Đây là điểm cân bằng tốt nhất: không chiếm quyền agent như proxy default, nhưng vẫn giải quyết pain chính là lưu lại session dài mà không copy thủ công.
