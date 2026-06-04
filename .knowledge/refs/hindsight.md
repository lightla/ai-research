# Hindsight

## Nó là gì
Hindsight là một hệ memory cho agent, tập trung vào học dần theo thời gian chứ không chỉ nhớ lại lịch sử hội thoại.

## Mô hình lưu trữ và runtime
- Service managed hoặc self-hosted
- Có Python và Node clients
- Dùng mô hình memory theo bank
- Background processing biến dữ liệu retained thô thành representation hữu ích hơn

## API chính
- `retain`
- `recall`
- `reflect`

## Kỹ thuật từ source code

### 4-Strategy Parallel Retrieval
`search/retrieval.py` chạy 4 strategy song song rồi gộp bằng Reciprocal Rank Fusion:

```
1. semantic   → vector embeddings (sentence-transformers hoặc TEI)
2. bm25       → keyword full-text search
3. graph      → link traversal từ entity extraction
4. temporal   → date-range aware search
```

Sau RRF: **cross-encoder reranking** dùng bi-encoder model riêng — không chỉ score, mà rerank lại thực sự.

### Entity Resolution Pipeline
`entity_resolver.py` extract + normalize entities → canonical entity form → graph link expansion. Đây là bước trước khi ghi vào memory bank, không phải chỉ raw text.

### Disposition Traits
Mỗi memory bank có 5 traits (ví dụ: skepticism, literalism, empathy từ 1-5). Các traits này ảnh hưởng output của `reflect` — cùng một data, bank khác nhau có thể reflect ra insight khác nhau.

### Enterprise DB Support
- Alembic migrations với **dialect-aware**: `run_for_dialect(pg=..., oracle=...)`
- Hỗ trợ **Oracle 23ai** (vector type native) — duy nhất trong nhóm
- Multi-tenant search_path với schema-qualified SQL
- HNSW index trên PostgreSQL

### Bank Isolation
Mỗi bank là isolated store — không có cross-bank data leakage ở layer DB.

## Cơ chế thực tế đáng chú ý
- `retain` là cửa ghi chính cho dữ liệu vào memory bank.
- `recall` là lớp search/retrieval.
- `reflect` là lớp synthesis, tức là không chỉ trả dữ liệu mà còn rút ra kết luận mới.

## Vì sao quan trọng
- Nó mô hình hóa memory như thứ có thể tiến hóa
- Vòng `retain / recall / reflect` là mental model tốt để nâng cấp hệ
- Hữu ích nếu bạn muốn hệ tự tạo insight cấp cao từ event thô

## Điểm mạnh
- Tách bạch rõ giữa raw memory và derived insight
- Hợp cho personalization và learned behavior
- Cách framing thiên reasoning rất rõ

## Giới hạn
- **LLM dependency nặng**: fact extraction + entity resolution + reflect đều cần LLM call — không có offline path thực sự
- **Không có memory consolidation tường minh**: chỉ có fact extraction, không có evolution/versioning
- **Orchestration overhead**: 4 parallel streams + fusion + reranking → latency cao hơn single-strategy đáng kể
- **Không có capture lifecycle**: không hook vào agent session, không tự học từ vận hành
- Ít local-first hơn `RetainDB`
- Không phải interface chunk reader tối giản

## Mức độ phù hợp với mục tiêu của bạn
Reference tốt cho learning loop và derived insight.
