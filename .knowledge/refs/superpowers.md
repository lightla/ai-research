# Superpowers

## Nó là gì
`superpowers` là một bộ phương pháp phát triển phần mềm (software development methodology) cho Coding Agent, được xây dựng trên một tập hợp các kỹ năng (skills) có thể cấu thành và các chỉ thị ban đầu để bắt buộc agent tuân thủ quy trình làm việc có kỷ luật.

## Mô hình lưu trữ và runtime
- Hoàn toàn dựa trên Prompt và cơ chế nạp Skill động của nền tảng (Claude Code, Gemini CLI, Cursor, v.v.). Không chạy dịch vụ nền hay duy trì database lưu trữ động.
- Các kỹ năng được định nghĩa dưới dạng các file Markdown (`SKILL.md`) lưu tại thư mục cài đặt của plugin.
- Sinh ra các file đặc tả thiết kế tĩnh trong dự án tại thư mục `docs/superpowers/specs/`.

## Kỹ thuật từ source code

### SKILL.md Format
Mỗi skill là một file Markdown tự chứa:
- Metadata: tên, trigger condition, mô tả
- Instructions: hướng dẫn step-by-step cho agent
- Examples: ví dụ input/output

Skills có thể **gọi nhau** (composability) — một planning skill có thể invoke TDD skill khi cần.

### SessionStart Injection
Skill `using-superpowers` được inject vào đầu mỗi session để "huấn luyện" agent nhận biết khi nào cần dùng skill nào. Quy tắc 1%: nếu có bất kỳ 1% khả năng một skill liên quan → phải invoke nó.

### 30+ Skills (từ source)
- `writing-plans`, `test-driven-development`, `requesting-code-review`
- `dispatching-parallel-agents`, `writing-skills`
- Brainstorm → Planning → SDD → TDD là workflow mặc định

### Zero Infrastructure
- Không daemon, không DB, không network — chỉ file Markdown + platform Skill loader
- Specs output lưu vào `docs/superpowers/specs/` trong git repo

## Mô hình retrieval
- Sử dụng công cụ nạp Skill của nền tảng (`Skill` tool hoặc `activate_skill` tool) để nạp nội dung chi tiết của từng kỹ năng khi cần thiết.
- Ở đầu phiên làm việc (`SessionStart`), hệ thống inject kỹ năng hướng dẫn chung `using-superpowers` để huấn luyện agent cách tự động gọi các kỹ năng chuyên biệt khác khi có bất kỳ dấu hiệu liên quan nào (quy tắc 1% áp dụng).

## Vì sao quan trọng
- Thiết lập tính kỷ luật cực kỳ nghiêm khắc cho Coding Agent, ngăn chặn hành vi tự ý sửa code mà không có thiết kế hoặc kế hoạch rõ ràng.
- Định nghĩa quy trình làm việc chuẩn hóa qua nhiều bước: Brainstorming $\rightarrow$ Lập kế hoạch (Planning) $\rightarrow$ Phát triển qua Subagent (SDD) $\rightarrow$ Phát triển hướng kiểm thử (TDD).
- Hướng tới YAGNI (You Aren't Gonna Need It) và DRY để giảm thiểu sự phình to của mã nguồn.

## Điểm mạnh
- Siêu nhẹ, không tốn tài nguyên chạy daemon hay xử lý SQLite/Vector DB phức tạp.
- Cải thiện rõ rệt chất lượng code và khả năng tự chủ (autonomy) của agent trong thời gian dài (có thể chạy tự động nhiều giờ theo kế hoạch).
- Tài liệu hóa toàn bộ quá trình brainstorm và thiết kế dưới dạng specs tĩnh trong git repository.

## Giới hạn
- **Không có dynamic memory DB**: không lưu facts, events, decisions — mọi thứ mất khi session kết thúc
- **Prompt compliance dependent**: nếu agent không follow instructions → cả hệ sụp, không có fallback
- **Static specs**: `docs/superpowers/specs/` không tự update theo code thay đổi
- **Không có cross-project search**: knowledge không di chuyển giữa projects
- **Không có memory boundary**: không phân tách global/local

## Mức độ phù hợp với mục tiêu của bạn
- Là tài liệu tham khảo tuyệt vời để thiết kế **Lớp Quy trình / Hành vi (Process/Workflow Layer)** cho Smart Memory.
- Cách thiết kế các file `SKILL.md` có thể được tích hợp trực tiếp làm bộ công cụ chỉ thị hành vi cho Agent trong Smart Memory, giúp kết nối Lớp dữ liệu (SQLite/Chroma) với cách Agent ra quyết định.
