# Tổng Quan Nghiên Cứu Memory

## Vấn đề thật
Mục tiêu không phải cấm markdown.
Mục tiêu là không để agent phải đọc thẳng một file dài rồi tự đoán.

Ví dụ kiểu lỗi cũ:
- có `spec.md`
- agent đọc nguyên file
- sau đó trả lời sai về design
- phải nhắc đọc lại thì nó mới sửa

Đó là anti-pattern cần tránh.
Thay vào đó, phải có một trung tâm thông tin với một wrapper đọc thông minh:
- agent không đọc raw file dài trực tiếp
- tool sẽ đọc thay
- tool tự scope, chunk, lọc, trích xuất, xếp hạng
- tool chỉ trả về phần hữu dụng, đúng ngữ cảnh

## Mục tiêu
Xây một hệ memory cá nhân có các thuộc tính:
- nhanh
- ổn định
- hiệu quả thật
- layer rõ ràng, tường minh
- không bắt agent phải bị nhắc đi nhắc lại
- không bắt agent nuốt nguyên cục kiến thức rồi tự suy diễn sai

## Tiêu chí đánh giá
Mình không đánh giá theo cảm giác “dự án nào nổi tiếng hơn”, mà theo 7 trục:
- **Nguồn sự thật**: dữ liệu gốc nằm ở đâu, có schema rõ không
- **Đường ghi**: ghi thẳng, ghi theo hook, hay đi qua service trung tâm
- **Đường đọc**: đọc nguyên khối, đọc theo chunk, hay đọc qua pack/delta
- **Wrapper có thông minh không**: có tự scope, tự lọc, tự nén, tự chọn phần hữu ích không
- **Derived state**: có tạo summary / insight / representation / graph không
- **Tích hợp agent**: MCP, REST, SDK, hooks, plugin, hay chỉ là CLI
- **Khả năng vận hành**: local-first, server-first, cloud-first, hay hybrid

## Kết luận kỹ thuật
Hướng hợp lý nhất là một hệ hybrid, nhưng tối giản:
- **Canonical store**: JSON record là lựa chọn tốt nhất cho dữ liệu có cấu trúc; markdown vẫn dùng được cho tài liệu phụ hoặc input thô.
- **Trung tâm thông tin**: một service hoặc một tool layer đứng giữa agent và dữ liệu thô.
- **Wrapper đọc**: tool chuyên đọc, scope, chunk, extract, và nén kết quả.
- **Lớp tài liệu**: markdown chỉ là input / output phụ, không phải thứ agent phải tự đọc nguyên cục.
- **Lớp web**: có thể render tài liệu từ JSON cho user tra cứu/chỉnh sửa, nhưng mọi edit phải ghi ngược về JSON rồi reload state.
- **Phân lớp memory**: tách rõ `global` và `local` để không lẫn tri thức giữa các dự án; mỗi dự án local được định danh bằng một `project_id` duy nhất (UUID) lưu trong file cấu hình local.
- **Merge wizard**: phải có pipeline hỏi người dùng chọn tiêu chí merge khi muốn hợp nhất local/local hoặc local/global.
- **Project config file**: khởi tạo bằng `smem init`, chứa file cấu hình siêu nhẹ (ví dụ `.smart-memory.config.json` hoặc `.smart-memory.config.yml`) lưu trong dự án để định danh `project_id` (UUID) và tên dự án.
- **Storage model**: sử dụng mô hình Hybrid (Centralized Storage + Local Config); dữ liệu memory được lưu tập trung tại global (`~/.smart-memory/projects/<project_id>`), còn dự án local chỉ lưu ID định danh.

Điểm mấu chốt là:
- markdown được phép tồn tại
- nhưng nó không được là thứ agent phải tự nuốt hết

## Snapshot hỗ trợ
Phần này cố tình trung lập. Nó ghi rõ từng project có hỗ trợ gì và không hỗ trợ gì, dựa trên source code và docs gốc.

### `agentmemory`
- Có hỗ trợ một worker iii-engine chạy lâu dài.
- Có hỗ trợ hooks, MCP, REST, và iii functions cùng trỏ về một state.
- Có hỗ trợ nhiều MCP tools qua central registry.
- Có hỗ trợ shared memory cho nhiều agent và nhiều client.
- Có hỗ trợ retrieval lai: BM25, vector, graph, rerank.
- Có hỗ trợ progressive disclosure trong smart search.
- Không thấy hỗ trợ giao diện chunk-reader riêng ở mức abstraction trung tâm.
- Không thấy hỗ trợ dùng markdown làm lớp lưu trữ nền.

### `RetainDB`
- Có hỗ trợ runtime local-first với API và viewer.
- Có hỗ trợ MCP tools cho `context_pack`, `context_delta`, `compress_output`, và `code_map`.
- Có hỗ trợ file local append-only đi kèm durable memory.
- Có hỗ trợ delivery theo token budget và delta.
- Có hỗ trợ phễu memory theo session / handoff / filesystem note.
- Có hỗ trợ wrapper đọc context theo pack, thay vì đọc nguyên file thô.
- Không thấy hỗ trợ làm backend product-memory tối giản, generic.

### `Honcho`
- Có hỗ trợ background reasoning trên messages và events đã lưu.
- Có hỗ trợ peers, sessions, peer cards, representations, và context bundles.
- Có hỗ trợ tích hợp MCP và SDK.
- Có hỗ trợ sinh prompt-ready context.
- Có hỗ trợ chia tách raw message và derived representation.
- Có hỗ trợ lớp context synthesis cho agent.
- Không thấy hỗ trợ chỉ cập nhật đồng bộ tức thời, vì reasoning chạy bất đồng bộ.
- Không thấy hỗ trợ filesystem-style memory tree như abstraction chính.

### `Mem0`
- Có hỗ trợ hosted API và self-hosted server.
- Có hỗ trợ Python và TypeScript SDK.
- Có hỗ trợ add, search, update, delete, list, và các flow quản trị liên quan.
- Có hỗ trợ retrieval theo vector, keyword, entity, và temporal.
- Có hỗ trợ hệ adapter / backend đa dạng cho vector store, embedding, reranker.
- Có hỗ trợ layer API sản phẩm khá chuẩn.
- Không thấy hỗ trợ chủ yếu như hệ capture lifecycle cho coding agent.
- Không thấy hỗ trợ filesystem-style retrieval tree như abstraction trung tâm.

### `Hindsight`
- Có hỗ trợ các thao tác retain, recall, và reflect.
- Có hỗ trợ memory organization theo bank.
- Có hỗ trợ background processing và reasoning kiểu model.
- Có hỗ trợ đường tích hợp SDK-first và server-first.
- Có hỗ trợ tạo insight cấp cao từ dữ liệu retained.
- Có hỗ trợ loop học từ dữ liệu cũ.
- Không thấy hỗ trợ filesystem-paradigm memory layout như abstraction chính.
- Không thấy hỗ trợ JSON chunk reader nhỏ gọn như interface gốc.

### `OpenViking`
- Có hỗ trợ virtual filesystem cho context.
- Có hỗ trợ tiered context loading.
- Có hỗ trợ recursive directory retrieval.
- Có hỗ trợ visualized retrieval trajectories.
- Có hỗ trợ automatic session memory extraction.
- Có hỗ trợ abstraction `viking://` để duyệt context như cây thư mục.
- Có hỗ trợ reader kiểu `L0 / L1 / L2` rất rõ.
- Không thấy hỗ trợ làm memory primitive tối giản.
- Không thấy hỗ trợ coi flat vector storage là mô hình tổ chức chính.

### `Hermes`
- Có hỗ trợ built-in bounded memory trong `MEMORY.md` / `USER.md`.
- Có hỗ trợ session search bằng SQLite FTS5.
- Có hỗ trợ external memory provider plugins.
- Có hỗ trợ MCP và tool configuration.
- Có hỗ trợ provider memory chạy song song với built-in memory.
- Có hỗ trợ lớp orchestration để agent không phải tự nối nhiều hệ nhớ.
- Không thấy hỗ trợ built-in memory không giới hạn.
- Không thấy hỗ trợ lấy built-in memory thay thế cho external structured memory.

### `claude-mem`
- Có hỗ trợ Lifecycle Hooks tự động tích hợp với Agent CLI (Claude Code, Gemini CLI, Cursor, v.v.).
- Có hỗ trợ Progressive Disclosure qua phễu 3 tầng để tối ưu hóa token.
- Có hỗ trợ Web UI Viewer thời gian thực tại port 37777.
- Có hỗ trợ phân giải dự án thông qua Git Root.
- Có hỗ trợ SQLite FTS5 và Chroma DB cho hybrid search.
- Không thấy hỗ trợ mô hình lưu trữ Hybrid (co-located local config) mà lưu tập trung hoàn toàn ở Global.
- Không thấy hỗ trợ Đồ thị liên kết vĩ mô (Smart Macro-Graph) để tránh Hairball Problem.

## Cơ chế học của từng project
Lưu ý: đây không phải “deep learning” theo nghĩa neural network huấn luyện trọng số. Cái bạn cần ở đây là **memory learning loop**: thu thập -> chuẩn hoá -> nén -> suy luận -> củng cố -> truy hồi. Mình phân tích đúng theo cơ chế đó.

### `agentmemory`
Pipeline học của nó khá rõ:
- **Capture**: hook/observe thu sự kiện từ session, tool, prompt, image.
- **Dedup**: `DedupMap`, fingerprint, và sanitize để tránh lặp và rác.
- **Consolidate**: gom nhiều observation theo session/concept rồi gọi LLM để nén thành memory có cấu trúc.
- **Version / supersede**: memory cũ không bị “ghi đè ngốc”; nó có chain tiến hoá.
- **Lesson / insight**: phần `lessons` và `reflect` biến tín hiệu lặp thành bài học và insight có confidence.
- **Hybrid recall**: BM25 + vector + graph + rerank, rồi mới trả kết quả.

Ý nghĩa:
- học theo kiểu **capture → compress → reinforce → retrieve**
- mạnh cho shared memory service dùng chung nhiều agent
- không phải chỉ là kho lưu trữ, mà là một vòng sống của memory

### `RetainDB`
Nó học theo kiểu “context vận hành”:
- **Context pack**: tự đóng gói ngữ cảnh theo token budget, không dump raw.
- **Context delta**: chỉ lấy phần thay đổi so với context trước đó.
- **Append-only journal**: ghi theo kiểu có lịch sử, dễ audit, dễ replay.
- **Handoff**: biến memory thành gói chuyển giao giữa agent.
- **Compress output**: ép output tool về dạng ngắn, đúng mục tiêu.

Ý nghĩa:
- mạnh nhất ở **đường đọc**
- học bằng cách liên tục tạo pack/delta/handoff, không dựa vào “nhớ toàn bộ”
- cực hợp nếu mục tiêu là proxy/wrapper ở giữa agent và nguồn thô

### `Honcho`
Honcho học bằng cách tách raw signal và derived reasoning:
- **Explicit vs derived observation**: nó không trộn hết làm một.
- **Prefetch context**: lấy trước phần liên quan trước khi agent hỏi.
- **Session / peer model**: tri thức gắn với session và peer, không chỉ message rời.
- **Conclusions**: sinh kết luận riêng, tức là memory có lớp suy luận.
- **Dialectic synthesis**: agent nội bộ tổng hợp context theo kiểu phản biện/suy luận.

Ý nghĩa:
- memory không chỉ là “facts”, mà còn có lớp **conclusion / reasoning state**
- phù hợp nếu bạn muốn agent nhớ cả quan hệ và lập luận
- không phải kiểu storage đơn giản, mà là một system có nhận thức theo phiên

### `Mem0`
Mem0 học theo quy trình chuẩn hoá memory sản phẩm:
- **LLM extraction**: rút memory từ messages thành JSON có cấu trúc.
- **Dedupe**: hash + so khớp với memory hiện có.
- **Embed**: batch embed rồi đẩy vào store.
- **Hybrid ranking**: vector + keyword + entity + temporal.
- **Rerank / filter**: chọn đúng memory theo user/agent/run scope.

Ý nghĩa:
- mạnh ở **API memory chuẩn hoá**
- phù hợp làm backend portable cho app
- học khá rõ, nhưng thiên về “nhớ cho sản phẩm” hơn là “học trong vòng đời agent”

### `Hindsight`
Hindsight học bằng vòng retain/recall/reflect:
- **Retain**: lấy ra fact, entity, temporal signal, relation.
- **Normalize**: đưa về canonical entity, timeline, graph.
- **Reflect**: sinh insight/opinion, không chỉ lưu dữ liệu gốc.
- **Confidence**: opinion/insight có độ tin cậy riêng.
- **Bank model**: memory tách theo bank, dễ vận hành theo lớp.

Ý nghĩa:
- mạnh cho hệ cần **memory + reflection**
- memory cũ được nâng cấp thành hiểu biết mới
- phù hợp làm mẫu cho loop “học từ trải nghiệm”

### `OpenViking`
OpenViking học theo kiểu phân cấp và duyệt cây:
- **L0 / L1 / L2**: abstract → overview → details.
- **Recursive retrieval**: đi sâu theo cây thay vì quét phẳng hết.
- **Filesystem abstraction**: context được map như thư mục/đường dẫn.
- **Session end extraction**: cuối phiên sẽ bóc tách và cập nhật lại lớp memory.
- **Structured summaries**: summary có ngữ cảnh kế thừa, open loops, next step.

Ý nghĩa:
- đây là project gần nhất với yêu cầu của bạn về **wrapper đọc theo scope**
- rất hợp để tránh agent phải nuốt nguyên file dài
- mạnh ở **hierarchical compression + hierarchical access**

### `Hermes`
Hermes không phải memory lõi, mà là lớp orchestration:
- **Built-in memory**: vẫn có bộ nhớ local của riêng nó.
- **External providers**: memory bên ngoài được gắn qua plugin.
- **Prefetch / sync / cadence**: có nhịp đồng bộ và nhịp suy luận riêng.
- **Tool abstraction**: agent không cần biết provider bên dưới là gì.

Ý nghĩa:
- tốt để xem cách **trộn nhiều nguồn nhớ** vào một khung thống nhất
- không nên dùng nó làm canonical store cuối cùng nếu bạn cần schema riêng chặt chẽ

### `claude-mem`
Pipeline học của nó hoạt động tự động thông qua agent lifecycle:
- **Capture**: Tự động chặn các sự kiện sử dụng tool (`PostToolUse`) và prompt người dùng gửi về Server.
- **Normalize & Extract**: Chạy các tác vụ LLM nền để trích xuất `facts`, `concepts` và danh sách tệp thay đổi từ logs thô.
- **Compress**: Khi phiên làm việc kết thúc (`SessionEnd`), LLM sẽ tóm tắt (summarize) toàn bộ diễn biến thành một `summary` dài hạn.
- **Retrieve**: Bơm ngược lại ngữ cảnh đã tóm tắt vào phiên làm việc tiếp theo (`SessionStart`) bằng cơ chế Progressive Disclosure 3 tầng.

Ý nghĩa:
- Học tự động hoàn toàn mà không cần Agent chủ động thực hiện lệnh lưu trữ.
- Phễu nén và truy hồi 3 tầng là mô hình tối ưu chi phí token cực tốt.

## Khuyến nghị cho hệ riêng của bạn
Nếu mục tiêu là build solution riêng, mình sẽ giữ hệ rất gọn:
1. **Canonical store**: JSON có schema, version, type, source, relation.
2. **Reader proxy**: đọc theo scope, chunk, pack, delta, tree slice.
3. **Writer service**: nhận event, dedupe, promote, summarize, ghi durable.
4. **Tool layer**: MCP/HTTP để mọi agent gọi chung một trung tâm.

Markdown vẫn có thể nằm trong hệ này, nhưng:
- nó chỉ là input/output phụ
- nó không phải thứ agent phải tự nuốt nguyên cục
- wrapper phải làm nhiệm vụ nén và trích xuất

## Thiên hướng thiết kế
Nếu làm thật, mình sẽ nghiêng về:
- JSON schema cho dữ liệu có cấu trúc
- markdown chỉ là nguồn phụ hoặc tài liệu người dùng đưa vào
- record ID ổn định thay vì note tự do
- explicit read API thay vì đọc file trực tiếp
- một server process thay vì spawn memory worker cho từng agent
- retrieval pack thay vì dump cả document
- learning loop rõ ràng: observe → extract → normalize → compress → reinforce → recall
- web app chỉ là lớp view/edit trên top của JSON canonical store
- memory boundary phải tách `global` và `local`, không dùng một kho mù quáng cho mọi project
- merge giữa project phải là flow có wizard, không merge âm thầm; wizard cần cho chọn tiêu chí như chủ đề, đối tượng, khái niệm, quyết định, pattern, relation, hoặc local→global
- config theo project chứa `project_id` định danh duy nhất nằm ngay trong project để điều hướng lưu trữ
- nên dùng mô hình Hybrid: lưu dữ liệu thật tại Global Server và chỉ định cấu hình/ID ở Local Project
- **Tập trung vào Situational Metadata**: Memory phải lưu được "Tại sao" (Rationale, trade-offs, constraints, domain scale) thay vì chỉ nhân bản thông tin thô/boilerplate của code.
- **Cơ chế Situational Query**: Hỗ trợ truy vấn sâu theo bối cảnh và ý đồ (Intent & Constraints) để trả về Reasoning-Ready Context cho Agent thế hệ sau.
- **Đồ thị liên kết vĩ mô (Smart Macro-Graph)**: Tập trung vẽ mối liên hệ lớn giữa các Module, Entity, Decision, Constraint thay vì các hàm/file lẻ tẻ để tránh "Hairball Problem", hỗ trợ duyệt phân cấp (Hierarchical Graph Navigation - Big Picture trước, Zoom-in sau).
