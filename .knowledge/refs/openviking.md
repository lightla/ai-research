# OpenViking

## Nó là gì
OpenViking là context database cho AI agent, dùng filesystem paradigm thay vì mô hình flat vector thuần.

## Mô hình lưu trữ và runtime
- Context được tổ chức như virtual filesystem
- Entry map sang URI dạng `viking://`
- Context được load theo tầng
- Retrieval đi theo recursive search có hiểu directory
- Session activity có thể được compress thành long-term memory

## Kỹ thuật từ source code

### C++ Core Engine
- Vector ops được implement bằng **C++** với **pybind11** Python bindings
- **HNSW index**: Approximate Nearest Neighbor production-grade
- Custom `zip_sort.h`, `ann_utils.h` cho vector operations

### Multi-Tier Storage thực sự
```
L0 (volatile in-memory)  → hot vectors, thấp latency nhất
L1 (persistent disk)     → checkpoint snapshots, survive restart
L2 (external/cloud)      → long-term archival
```
Auto-promote hot vectors lên L0, archive cold vectors xuống L2.

### Filesystem Abstraction
- Context entries được map sang URI dạng `viking://`
- Tools: `ls`, `find`, `read`, `tree`, `abstract`, `overview` — duyệt context như duyệt filesystem
- Retrieval strategy: **lock directory có score cao trước, rồi drill-down** — không phải quét phẳng hết

## Cơ chế thực tế đáng chú ý
- `ls`, `find`, `read`, `tree`, `abstract`, `overview` biến context thành một cây duyệt được.
- Dữ liệu có `L0 abstract`, `L1 overview`, `L2 details` để đọc theo mức cần thiết.
- Retrieval strategy là “lock directory có điểm cao trước, rồi drill-down”, không phải chỉ vector search đơn lớp.
- Session end có memory extraction để cập nhật user/agent memory directories.

## Vì sao quan trọng
- Nó đi thẳng vào vấn đề bạn đang lo: tránh markdown làm trung tâm
- Nó coi memory là cấu trúc có thể duyệt, không phải blob
- Nó mạnh ở retrieval theo chunk, có tầng, và quan sát được

## Điểm mạnh
- Load theo tầng
- Recursive retrieval
- Visualized retrieval trajectory
- Mô hình tổ chức context khá rõ
- Rất gần với ý tưởng “reader theo phần”

## Giới hạn
- **Pure vector engine**: không có memory semantics — không biết "consolidate", "lesson", "reasoning" là gì
- **Low-level abstraction**: cần nhiều wrapper để dùng như memory system có ý nghĩa
- **Không có lifecycle capture**: không tự học từ session end
- **Documentation nghèo**: C++ internals khó reason cho người không quen vector index
- Nếu bạn chỉ cần personal memory thì đây là hệ rộng hơn mức cần thiết

## Mức độ phù hợp với mục tiêu của bạn
Reference rất tốt cho đường đọc và cách tổ chức cấu trúc.
