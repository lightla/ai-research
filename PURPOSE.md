# PURPOSE

Tài liệu này tồn tại để chốt rõ mục tiêu của project, tránh cho người mới vào phải đoán ý đồ từ tên file hay từ các memo rời rạc.

## Mục tiêu cốt lõi
Project này nghiên cứu và thiết kế một hệ memory cho agent theo hướng:
- **nhanh**
- **ổn định**
- **hiệu quả**
- **layer rõ ràng**
- **agent có thể tự truy cứu**
- **không phải nhắc đi nhắc lại**

## Ý tưởng chính
`JSON` là **single source of truth** cho memory và kiến thức có cấu trúc.

`Markdown` vẫn được dùng nếu cần, nhưng không phải là nơi agent phải đọc thẳng theo kiểu dump toàn bộ file dài.
Thay vào đó phải có một **wrapper / proxy / tool layer** ở giữa:
- đọc nguồn thô
- tự scope theo câu hỏi
- tự chunk / filter / extract
- tự nén context
- trả về phần thật sự hữu dụng cho agent

## Hai loại memory
Project này tách memory thành 2 lớp rõ ràng:

### `global`
- Là memory toàn cục.
- Mọi project đều có thể biết về nó.
- Dùng cho tri thức nền, quy ước chung, kiến trúc lõi, pattern đã chốt.

### `local`
- Là memory chỉ nội tại trong một project cụ thể.
- Không được tự ý lẫn sang project khác.
- Dùng cho spec, quyết định cục bộ, trạng thái riêng, ghi chú theo dự án.

## Cơ chế merge memory
Ngoài tách `global/local`, hệ này cần có khả năng merge thông minh giữa các project:

- `projectA` và `projectB` có thể cùng nói về một tư tưởng, một pattern, hoặc một đối tượng.
- Nhưng nội dung ban đầu bị chia mảnh theo từng project.
- Hệ phải có cơ chế gom các phần liên quan lại mà không làm loạn boundary.

### Mục tiêu của merge
- hợp nhất tri thức trùng hoặc gần trùng
- giữ lại provenance và nguồn gốc
- tránh “merge mù” làm mất ngữ cảnh
- cho phép nâng một phần local lên global khi đủ chín

### Merge targets
Merge có thể diễn ra theo nhiều tiêu chí:
- theo **chủ đề**
- theo **đối tượng**
- theo **khái niệm**
- theo **quyết định**
- theo **pattern**
- theo **quy trình**
- theo **relation / graph**

### Wizard merge
Tool không nên tự merge âm thầm.
Nó phải hỏi người dùng bằng wizard để chọn tiêu chí merge.

Wizard cần liệt kê rõ các option, ví dụ:
1. merge theo chủ đề
2. merge theo đối tượng
3. merge theo khái niệm
4. merge theo quyết định
5. merge theo pattern
6. merge theo relation
7. merge local vào global
8. merge local với local giữa nhiều project

### Pipeline merge
1. scan candidate memory từ local/global liên quan
2. nhóm theo tiêu chí đã chọn
3. hiển thị danh sách cụm trùng hoặc gần trùng
4. user chọn cụm nào được merge
5. hệ tạo bản merged record mới
6. lưu provenance của từng nguồn
7. giữ lại bản cũ dưới dạng superseded hoặc alias
8. reload index / web / cache

### Nguyên tắc
- không merge nếu chưa có tiêu chí rõ
- không overwrite thẳng làm mất history
- không phá boundary project nếu chưa được phép
- không đẩy local lên global chỉ vì giống bề mặt
- merge phải là hành động có chủ đích, có thể audit lại

## Vì sao phải tách
Trước đây ICM lưu trữ quá mù quáng:
- ghi mọi thứ vào cùng một chỗ
- không phân biệt global hay local
- không có boundary rõ
- thành ra project này bị lẫn sang project kia

Đó là lỗi kiến trúc, không phải lỗi của agent.

## Cách định danh project
Best practice là dùng `hash(project path)` để tạo `project_id` duy nhất.

Mục đích:
- tránh collision giữa các project có tên giống nhau
- tránh lẫn memory giữa các workspace khác nhau
- giữ boundary local thật sự rõ ràng

## Khởi tạo và Cấu hình Project (CLI Tool `smem init`)
Để thiết lập mô hình Hybrid một cách tự động và nhất quán, CLI tool của hệ thống (ví dụ: `smem`) sẽ cung cấp lệnh khởi tạo `smem init`.

### Quy trình của lệnh `smem init`
Khi người dùng chạy `smem init` trong thư mục gốc của một dự án local:
1. **Kiểm tra file cấu hình hiện tại**: Nếu phát hiện file `.smart-memory.config.json` (hoặc `.yml`) đã tồn tại, nó sẽ cảnh báo người dùng để tránh ghi đè ngẫu nhiên làm mất liên kết với memory cũ.
2. **Tự động sinh Metadata**:
   - `project_id`: Sinh một mã UUID v4 duy nhất (ví dụ: `proj_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d`).
   - `project_name`: Lấy tên thư mục hiện tại làm tên dự án mặc định (người dùng có thể thay đổi sau).
3. **Tạo file cấu hình local**: Ghi file `.smart-memory.config.json` với nội dung tối giản:
   ```json
   {
     "project_id": "proj_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
     "project_name": "my-cool-app"
   }
   ```
4. **Khởi tạo thư mục ở Global Store**: CLI gọi API server hoặc tự tạo thư mục lưu trữ thực tế tại:
   `~/.smart-memory/projects/proj_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d/`
5. **Đăng ký với Global Registry**: Lưu thông tin ánh xạ giữa `project_id`, `project_name` và `root_path` hiện tại lên server để phục vụ hiển thị trên Web view hoặc tra cứu chéo.

### Nguyên tắc của File Cấu hình Local
- Config project phải nằm trong project và được khuyến nghị commit lên Git để chia sẻ trong team.
- File config là metadata định danh (chỉ chứa các trường thông tin tối giản để ánh xạ dữ liệu), tuyệt đối không chứa dữ liệu memory chính.
- Nếu config bị mất, người dùng có thể khôi phục bằng cách gán lại `project_id` cũ từ Global Registry.

## Memory lưu ở đâu
Hệ thống sử dụng mô hình **Hybrid (Centralized Storage + Local Config)** để đạt được mục tiêu tạo ra một **Unified Memory Layer** nhưng không làm bẩn dự án local và khắc phục triệt để các nhược điểm của việc lưu trữ phân tán.

### Thiết kế chi tiết

#### 1. Centralized Global Store (Nơi lưu dữ liệu thật)
Toàn bộ dữ liệu memory thực sự (JSON record, SQLite DB, Vector index) của tất cả các dự án được quản lý tập trung bởi Server tại thư mục global:
- Đường dẫn: `~/.smart-memory/projects/<project_id>/`
- Lợi ích:
  - Giữ cho thư mục dự án local hoàn toàn sạch sẽ, không bị phình to dung lượng bởi các file database/index.
  - Server dễ dàng quản lý việc đọc ghi, lock file đồng thời từ nhiều agent/client mà không sợ conflict.
  - Hỗ trợ đánh index toàn cục và tìm kiếm chéo (cross-project search) cực kỳ nhanh chóng.

#### 2. Local Project Config (Nơi lưu định danh)
Mỗi dự án local chỉ lưu giữ duy nhất một file config siêu nhỏ (ví dụ `.smart-memory.config.json` hoặc `.smart-memory.config.yml`) trong thư mục root của dự án.
- Nội dung file config chứa định danh duy nhất của dự án:
  ```json
  {
    "project_id": "proj_9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
    "project_name": "my-cool-app"
  }
  ```
- Cơ chế phân giải: Khi Agent hoặc Server làm việc tại một dự án, nó sẽ đọc file config này để lấy ra `project_id`, sau đó truy xuất/ghi dữ liệu vào thư mục tương ứng `~/.smart-memory/projects/<project_id>/` tại global.

### Ưu điểm vượt trội của mô hình Hybrid
- **Tránh Path Drift**: Dù dự án bị đổi tên hoặc di chuyển sang đường dẫn khác (làm thay đổi hash của path), `project_id` lưu bên trong file config vẫn giữ nguyên $\rightarrow$ memory không bao giờ bị đứt liên kết.
- **Hỗ trợ Team Collaboration**: File config nhỏ này có thể commit lên Git. Khi thành viên khác clone dự án về, họ sẽ dùng chung `project_id`, giúp việc đồng bộ/chia sẻ memory của dự án qua cloud/team server trở nên khả thi.
- **Quản lý rác tốt hơn**: Server dễ dàng quét và liệt kê danh sách dự án trong registry, hỗ trợ dọn dẹp các thư mục memory cũ (nếu dự án local tương ứng không còn tồn tại).

## Yêu cầu thêm về web
Project không chỉ lưu và đọc dữ liệu.
Nó còn cần một luồng rõ ràng để:
1. sinh web từ tài liệu / JSON
2. cho user đọc, tra cứu, chỉnh sửa trên web
3. khi user sửa, app phải ghi ngược lại vào `JSON`
4. sau đó reload / refresh trạng thái web để hiển thị đúng dữ liệu mới

Nghĩa là:
- `JSON` là nguồn sự thật
- web chỉ là lớp hiển thị và chỉnh sửa
- thay đổi từ web phải được phản ánh lại vào `JSON`
- app web phải đọc lại state mới sau khi ghi

## Vì sao project này tồn tại
Vì cách làm cũ kiểu:
- có một file spec dài
- agent đọc nguyên file
- sau đó trả lời sai hoặc quên design
- người dùng phải nhắc lại nhiều lần

đã chứng minh là không ổn.

Project này tồn tại để thay thế kiểu đó bằng một hệ thống mà:
- thông tin có trung tâm rõ ràng
- đọc theo ngữ cảnh, không đọc thô
- update một lần, nhiều agent cùng dùng
- user và agent đều có thể truy cập cùng một nguồn sự thật

## Nguyên tắc thiết kế
- Không dùng raw markdown dump làm trung tâm đọc chính.
- Không để agent phải nuốt cả file dài để hiểu một phần nhỏ.
- Không để kiến thức bị phân mảnh ở nhiều file mà không có canonical store.
- Không làm kiến trúc phình to nếu một proxy + JSON là đủ.
- Ưu tiên thứ thực sự hữu dụng cho agent hơn là cách tổ chức nhìn có vẻ đẹp.

## Kết quả mong muốn
Khi project hoàn chỉnh, nó phải cho phép:
- agent hỏi và nhận đúng context cần thiết
- user duyệt tài liệu qua web
- user sửa tài liệu trên web
- sửa xong thì dữ liệu gốc đổi theo
- web và memory không lệch nhau
- lần sau agent vào không cần người dùng nhắc lại design cũ
