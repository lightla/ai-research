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
- Ít giống filesystem hơn `OpenViking`
- Ít local-first hơn `RetainDB`
- Không phải interface chunk reader tối giản

## Mức độ phù hợp với mục tiêu của bạn
Reference tốt cho learning loop và derived insight.
