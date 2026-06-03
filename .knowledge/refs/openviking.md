# OpenViking

## Nó là gì
OpenViking là context database cho AI agent, dùng filesystem paradigm thay vì mô hình flat vector thuần.

## Mô hình lưu trữ và runtime
- Context được tổ chức như virtual filesystem
- Entry map sang URI dạng `viking://`
- Context được load theo tầng
- Retrieval đi theo recursive search có hiểu directory
- Session activity có thể được compress thành long-term memory

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
- Đây là context database nhiều hơn là memory primitive tối giản
- Nếu bạn chỉ cần personal memory thì đây là hệ rộng hơn mức cần thiết

## Mức độ phù hợp với mục tiêu của bạn
Reference rất tốt cho đường đọc và cách tổ chức cấu trúc.
