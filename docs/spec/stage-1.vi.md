# Pocketful — Stage 1: thanh toán và settlement

> **Bản dịch tham khảo để đọc hiểu.** Bản chuẩn là [stage-1.md](stage-1.md) (tiếng Anh, nguyên văn của ban tổ chức).
> Khi giao việc cho band, luôn dán **bản tiếng Anh**, không dán bản này. Tên endpoint, field, mã lỗi và JSON được giữ nguyên.

Stage này định nghĩa service ban đầu và API của nó.

Xây dựng dựa trên yêu cầu được cung cấp. Không được dùng source code, tài liệu API hay schema
của các sản phẩm có sẵn trong lĩnh vực này.

## 1. Phạm vi

Người dùng có thể gửi tiền theo handle, yêu cầu người khác trả tiền (request) và chia hóa đơn.
Các khoản thanh toán (payment) xuất hiện trong activity feed với chế độ hiển thị công khai hoặc
riêng tư. Operator được ủy quyền có thể gửi các nhóm lệnh chuyển tiền dưới dạng settlement.
Chỉ cần HTTP API.

Các điều sau áp dụng cho mọi thao tác, kể cả request đồng thời và request gửi lại (retry):

1. Tổng số dư các ví luôn bằng tổng được seed ở lần `POST /_test/reset` gần nhất.
2. Không số dư ví nào được âm, kể cả âm tạm thời.
3. Một request thanh toán chỉ được chuyển tiền tối đa một lần.

Mọi số tiền là số nguyên chính xác tính theo đơn vị nhỏ nhất (minor unit). Nạp tiền, top-up, rút
tiền, thẻ và kết nối ngân hàng nằm ngoài phạm vi. Tiền chỉ di chuyển giữa các ví đã tồn tại.

## 2. Giao nộp và triển khai

Giao một HTTP service, một `Dockerfile` và một `RUN.md` chứa lệnh build và khởi động service mà
không cần thiết lập thủ công. Ngôn ngữ, framework và storage không bị giới hạn.
`docker-compose.yml` là tùy chọn.

Bài nộp là một HTTP service đóng gói trong container, không phải một package Python. Không bắt
buộc dùng Python. TypeScript/JavaScript, Go, Rust, Java, Python hay bất kỳ ngôn ngữ nào khác
đều hợp lệ như nhau. Harness build `Dockerfile` được nộp, khởi động image và chỉ test hành vi
HTTP của nó; harness không import hay thực thi file source của bài nộp trên máy chấm.

Image phải tự chạy được với `-e PORT=<port>` và một port mapping. Mạng lúc chạy không có truy cập
ra ngoài. Mọi dependency lúc chạy, bước khởi tạo và dữ liệu seed phải hoạt động trong một
container duy nhất đó. Cấu hình Compose không được dùng để khởi động service.

### Giới hạn tài nguyên

Service phải hoạt động trong các giới hạn sau:

| Giới hạn | Giá trị |
|---|---|
| CPU | 2 vCPU |
| Bộ nhớ | 2 GiB |
| Từ lúc khởi động đến response healthy đầu tiên | 60 s |
| Request đồng thời | tối đa 50 request đang xử lý |
| Timeout mỗi request | 5 s (10 s cho `POST /_test/reset`) |
| Mạng ra ngoài | có trong lúc `docker build`, **không có lúc chạy** |
| Ổ đĩa | tạm thời; state không cần tồn tại qua lần khởi động lại container |

Tài nguyên và dependency lúc chạy phải nằm trong image, bao gồm font, script và stylesheet;
dịch vụ bên ngoài không truy cập được lúc chạy.

## 3. Hợp đồng runtime

### 3.1 Lắng nghe

Lắng nghe trên `0.0.0.0` với biến môi trường `PORT`, mặc định `8080`.

### 3.2 Health

```http
GET /health  ->  200  {"status": "ok"}
```

Trả 200 khi service và kho dữ liệu của nó đã phục vụ được request, trong vòng 60 giây kể từ khi
container khởi động. Trước khi sẵn sàng thì được phép trả response khác 200.

### 3.3 Reset và seed

```http
POST /_test/reset
Content-Type: application/json

{ ...fixture... }

->  204 No Content
```

Thay toàn bộ state của service bằng fixture trong body (§4). Khi reset trả 204, các request sau
đó chỉ được thấy fixture này. Phải hỗ trợ reset nhiều lần. Endpoint test này phải được bật trong
image giao nộp và không cần xác thực.

### 3.4 Quy ước

- Request và response là `application/json; charset=utf-8`.
- Timestamp trong response theo RFC 3339 với offset rõ ràng, ví dụ `2026-09-24T19:00:00+02:00`.
- Field lạ trong body request bị bỏ qua, không bao giờ là lỗi.
- Query parameter lạ bị bỏ qua.
- ID là chuỗi mờ (opaque) tối đa 64 ký tự. Định dạng do bạn chọn.

## 4. Mô hình

Service có **một loại tiền duy nhất**, khai báo trong fixture. Mọi số tiền trong API là số nguyên
đếm theo đơn vị nhỏ nhất của loại tiền đó: `1000` trong service có `minor_units: 2` là €10.00,
còn `1000` trong service có `minor_units: 0` là ¥1000.

Số tiền trong API phải có giá trị số nguyên: JSON `1000`, `1000.0` và `1e3` đều biểu diễn cùng
một số tiền hợp lệ. Boolean và chuỗi không được coi là số ở đây.

### Người dùng và handle

Mỗi người dùng có một **handle**: duy nhất trong toàn service, khớp `^[a-z0-9_]{1,20}$`, và không
bao giờ thay đổi sau khi đã đặt. Người dùng xác định người nhận bằng handle. Endpoint danh bạ và
tìm kiếm người dùng nằm ngoài phạm vi.

Người dùng được seed lấy handle từ fixture. Người dùng tạo qua `POST /auth/signup` (§6 — body
signup không có field `handle`) có handle được **suy ra** từ email: lấy phần trước @, chuyển thành
chữ thường, thay mọi ký tự ngoài `[a-z0-9_]` bằng `_`, rồi cắt còn tối đa 20 ký tự. Nếu handle đó
đã có người dùng thì signup thất bại; xem bảng signup ở §6.

Người dùng mới bắt đầu với số dư `0`. Họ có thể nhận tiền và bị yêu cầu trả tiền ngay lập tức.

### Payment và request

Một **payment** chuyển tiền từ ví này sang ví khác, ngay lập tức và nguyên tử. Payment được gửi
trực tiếp hoặc được tạo ra khi trả một request.

Một **request** yêu cầu ai đó trả tiền. `requester` là người sẽ nhận tiền; `payer` là người được
yêu cầu trả. Request ở trạng thái `pending`, sau đó chuyển sang đúng một trong `paid`, `declined`
hoặc `cancelled`. Chỉ payer được trả hoặc từ chối; chỉ requester được hủy.

**Request được phép vượt quá số dư của payer.** Đó là trạng thái hợp lệ, không phải lỗi lúc tạo:
request giữ `pending` cho đến khi được trả, bị từ chối hoặc bị hủy. Cố trả khi thiếu tiền là
`409 insufficient_funds` và không thay đổi gì. Tiền có thể đến sau, và khi đó chính request ấy
trả được.

**Chế độ hiển thị thuộc về payment, không thuộc về request.** Payer chọn nó lúc tiền được chuyển.
Request không có chế độ hiển thị riêng và không bao giờ xuất hiện trong feed của người khác.

### Hợp đồng của feed

`GET /activity` chỉ trả về payment. Một payment xuất hiện với người gọi **khi và chỉ khi**
`visibility` của nó là `public`, **hoặc** người gọi là người gửi hay người nhận của nó. Không có
quy tắc nào khác, không có quan hệ follow và không có danh sách chặn. Request không bao giờ xuất
hiện trong activity feed; chúng được đọc qua `GET /requests`, endpoint này chỉ trả các request mà
người gọi là requester hoặc payer.

Split không phải một mục trong feed. Các request mà split tạo ra hiển thị với hai bên của từng
request, và các payment trả cho chúng về sau tuân theo quy tắc ở trên.

Chế độ hiển thị là **một giá trị trên payment**, cả hai bên và mọi người khác đều thấy giống nhau.
Payment `private` bị ẩn với bên thứ ba, không ẩn với chính người nhận của nó.

### Phạm vi số học

`amount` tối đa là `1000000000` trên mỗi request, và không thao tác nào tạo ra số dư vượt ±2⁵³.
Phép tính tiền phải giữ chính xác giá trị minor unit, không có sai số làm tròn.

### Định dạng fixture

```json
{
  "currency": "EUR",
  "minor_units": 2,
  "users": [
    { "id": "u_ada", "email": "ada@example.com", "password": "correct horse",
      "display_name": "Ada", "handle": "ada", "balance": 10000 },
    { "id": "u_bob", "email": "bob@example.com", "password": "correct horse",
      "display_name": "Bob", "handle": "bob", "balance": 2500 }
  ],
  "payments": [
    { "id": "p_1", "from_user_id": "u_ada", "to_user_id": "u_bob",
      "amount": 500, "note": "coffee", "visibility": "public" }
  ],
  "requests": [
    { "id": "rq_1", "requester_id": "u_bob", "payer_id": "u_ada",
      "amount": 1200, "note": "taxi", "status": "pending" }
  ]
}
```

- Người dùng được seed phải đăng nhập được ngay bằng mật khẩu đã cho.
- `balance` là số dư ví **sau khi** mọi payment được seed đã được áp dụng. Các con số seed nhất
  quán với nhau; bạn không chạy lại các payment được seed lên số dư.
- `balance` dưới 0 trong fixture là lỗi reset: trả `422 validation_failed` từ
  `POST /_test/reset` và không thay đổi gì.
- `minor_units` là `0`, `2` hoặc `3`. Fixture dùng `EUR` (2), `JPY` (0) và `BHD` (3).

Endpoint quản trị số dư nằm ngoài phạm vi.

## 5. Lỗi

Mọi response 4xx và 5xx mang body sau:

```json
{ "error": { "code": "insufficient_funds", "message": "human readable, any wording" } }
```

Dùng đúng HTTP status và `code` được quy định. `message` cho người đọc thì diễn đạt thế nào cũng
được. Lỗi riêng của từng endpoint được liệt kê cùng endpoint đó.

| Status | `code` | Khi nào |
|---|---|---|
| 400 | `malformed_request` | Body không parse được, hoặc một field sai kiểu JSON |
| 400 | `missing_idempotency_key` | Thiếu header `Idempotency-Key` bắt buộc hoặc header rỗng |
| 401 | `unauthenticated` | Bearer token bị thiếu, sai định dạng hoặc không tồn tại |
| 403 | `forbidden` | Đã xác thực nhưng không có quyền với tài nguyên này |
| 404 | `not_found` | Không có tài nguyên đó, hoặc người gọi không được thấy nó |
| 409 | `idempotency_key_reuse` | Key đã được người gọi này dùng với body request khác |
| 422 | `validation_failed` | Thiếu field hoặc query parameter bắt buộc, hoặc vi phạm một quy tắc đã nêu mà không có code cụ thể hơn |

Một field đúng kiểu JSON nhưng sai định dạng hoặc giá trị ngoài phạm vi thì trả 422
`validation_failed`, trừ khi endpoint quy định lỗi khác. Bao gồm ngày không hợp lệ, số đếm âm và
giá trị vượt mức tối đa hoặc độ dài cho phép. Ngoài ra:

- Quy tắc field riêng của endpoint được ưu tiên: giá trị `amount` không hợp lệ (kể cả chuỗi và
  boolean), `note` không phải chuỗi (kể cả `null`), và `visibility` khác `public` hoặc `private`
  đều là 422 `validation_failed`. Chỉ khi bỏ hẳn field thì mới dùng giá trị mặc định của field
  tùy chọn. Các trường hợp sai kiểu JSON khác theo quy tắc bên dưới.
- **Query parameter** kiểu số nguyên phải viết bằng chữ số thập phân thuần: `1e9`, `4.0` và `+4`
  là 422 `validation_failed` bất kể giá trị số của chúng.
- Chỉ dùng 400 `malformed_request` cho body không parse được hoặc field sai kiểu.

Phạm vi dùng chung, áp dụng cho mọi endpoint nhận các tham số này:

| Field | Hợp lệ | Nếu không |
|---|---|---|
| `Idempotency-Key` | 1 đến 255 ký tự | 422 `validation_failed` |
| `limit` | số nguyên 1 đến 200 | 422 `validation_failed` |
| `offset` | số nguyên từ 0 trở lên | 422 `validation_failed` |

Request không được tạo ra response 5xx, kể cả khi tải đồng thời.

## 6. Xác thực

Xác thực gồm signup và login. Xác minh email, đặt lại mật khẩu, refresh token và endpoint quản lý
vai trò nằm ngoài phạm vi. Các quy tắc phân quyền nêu ở chỗ khác trong yêu cầu vẫn áp dụng.

```http
POST /auth/signup
{ "email": "a@example.com", "password": "correct horse", "display_name": "Ada" }

->  201  { "user_id": "u_1", "display_name": "Ada", "token": "..." }
```

```http
POST /auth/login
{ "email": "a@example.com", "password": "correct horse" }

->  200  { "user_id": "u_1", "display_name": "Ada", "token": "..." }
```

| Trường hợp | Response |
|---|---|
| Email đã được đăng ký | 409 `email_taken` |
| Mật khẩu ngắn hơn 8 ký tự | 422 `validation_failed` |
| `email` không có dạng `local@domain` | 422 `validation_failed` |
| Sai mật khẩu hoặc email không tồn tại khi login | 401 `unauthenticated` |
| Handle suy ra từ email (§4) đã có người dùng | 409 `handle_taken`, và không tạo tài khoản nào |

Mọi endpoint khác đều cần bearer token, trừ `/health`, `/_test/reset` và hai endpoint trên.
Các endpoint API của ví cần xác thực.

```http
Authorization: Bearer <token>
```

Token không hết hạn. Một tài khoản có thể có nhiều token hợp lệ và nhiều phiên đồng thời.

Mật khẩu phải được lưu bằng hàm băm mật khẩu như bcrypt, scrypt, Argon2 hoặc tương đương.
Không được lưu mật khẩu dạng văn bản thuần.

## 7. Idempotency

Năm đường ghi cần idempotency key (§8 và §11): **`POST /payments`**, **`POST /requests`**,
**`POST /requests/{id}/pay`**, **`POST /splits`** và **`POST /settlements`**. Mọi điều dưới đây
áp dụng độc lập cho từng đường.

```http
Idempotency-Key: <chuỗi do client chọn, 1..255 ký tự>
```

Key có phạm vi theo **người dùng đã xác thực**. Hai người dùng khác nhau có thể dùng cùng một
chuỗi key mà không ảnh hưởng gì đến nhau.

Một lần replay (gửi lại) là khi cùng một người dùng gửi **cùng method, cùng path và cùng body**.
Cùng key và cùng body nhưng khác path là một request khác, không phải replay, và phải thành công
bình thường.

| Tình huống | Response |
|---|---|
| Thiếu header hoặc header rỗng | 400 `missing_idempotency_key` |
| Lần đầu dùng key | Response bình thường, **201** |
| Replay: cùng key, cùng body | **200**, body giống hệt response gốc (so sánh như giá trị JSON) |
| Cùng key, khác body | 409 `idempotency_key_reuse` |
| Dùng lại key sau khi request gốc thất bại với 4xx | Coi như lần đầu dùng |

"Cùng body" nghĩa là cùng giá trị JSON sau khi parse — thứ tự key và khoảng trắng không quan trọng.

Với các request giống hệt nhau gửi đồng thời bằng một key chưa dùng, đúng một request trả 201.
Các request còn lại trả 200 với cùng body. Thao tác chỉ có hiệu lực một lần.

Một lần replay thành công trả về response gốc, kể cả khi tài nguyên đã thay đổi hoặc đã bị hủy.
Nó không gây thêm thay đổi state nào.

Sau khi body đã parse được thành JSON object và người gọi đã xác thực, một key đã được dùng sẽ được
xử lý trước bước validate field của endpoint và trước các kiểm tra tài nguyên hiện tại. Vì vậy,
nếu đổi một request đã thành công sang body không hợp lệ mà giữ nguyên key thì vẫn trả
`409 idempotency_key_reuse`.

## 8. API

### `GET /me`

```json
{ "user_id": "u_ada", "display_name": "Ada", "handle": "ada",
  "balance": 10000, "currency": "EUR", "minor_units": 2 }
```

### `POST /payments`

**Một đường ghi idempotent.** Bắt buộc có `Idempotency-Key`; xem §7.

```http
POST /payments
Authorization: Bearer <token>
Idempotency-Key: 2f9c1a...

{ "to_handle": "bob", "amount": 1500, "note": "dinner", "visibility": "public" }
```

`note` là tùy chọn, mặc định `""`. `visibility` là tùy chọn, mặc định `"public"`.

```json
201
{
  "payment_id": "p_7",
  "from_user_id": "u_ada",
  "from_handle": "ada",
  "to_user_id": "u_bob",
  "to_handle": "bob",
  "amount": 1500,
  "currency": "EUR",
  "note": "dinner",
  "visibility": "public",
  "request_id": null,
  "created_at": "2026-09-24T11:04:03+00:00"
}
```

| Trường hợp | Response |
|---|---|
| Số dư của người gọi nhỏ hơn `amount` | 409 `insufficient_funds` |
| `amount` nhỏ hơn 1, lớn hơn 1000000000, hoặc không phải số nguyên | 422 `validation_failed` |
| `to_handle` là handle của chính người gọi | 422 `self_payment` |
| `note` dài hơn 200 ký tự | 422 `validation_failed` |
| `visibility` không phải `public` hay `private` | 422 `validation_failed` |
| Không có người dùng nào mang handle đó | 404 `not_found` |

Trừ tiền và cộng tiền là một bước nguyên tử. Một payment không bao giờ hiện ở ví này mà không
hiện ở ví kia, và payment thất bại không để lại dấu vết ở ví nào.

`note` được lưu và trả về nguyên văn: không cắt khoảng trắng, không escape, không chuẩn hóa.
Unicode và emoji phải giữ nguyên từng byte khi lưu rồi đọc lại.

### `POST /requests`

**Một đường ghi idempotent.**

```http
POST /requests
Idempotency-Key: 9b1f04...

{ "payer_handle": "ada", "amount": 1200, "note": "taxi" }
```

Người gọi là requester.

```json
201
{
  "request_id": "rq_4",
  "requester_id": "u_bob",
  "requester_handle": "bob",
  "payer_id": "u_ada",
  "payer_handle": "ada",
  "amount": 1200,
  "currency": "EUR",
  "note": "taxi",
  "status": "pending",
  "payment_id": null,
  "created_at": "2026-09-24T11:06:10+00:00"
}
```

| Trường hợp | Response |
|---|---|
| `amount` nhỏ hơn 1, lớn hơn 1000000000, hoặc không phải số nguyên | 422 `validation_failed` |
| `payer_handle` là handle của chính người gọi | 422 `self_request` |
| `note` dài hơn 200 ký tự | 422 `validation_failed` |
| Không có người dùng nào mang handle đó | 404 `not_found` |

**Ở đây không kiểm tra số dư của payer.** Request đòi nhiều hơn số payer đang có vẫn được tạo bình
thường và nằm ở trạng thái `pending`.

### `POST /requests/{id}/pay`

**Một đường ghi idempotent.** Chỉ payer được gọi.

```http
POST /requests/rq_4/pay
Idempotency-Key: c41d88...

{ "visibility": "private" }
```

Body chỉ chứa `visibility`, tùy chọn, mặc định `"public"`. Đây là lựa chọn của payer, không phải
của requester. **Replay phải gửi body giống hệt** — `{}` và `{"visibility": "public"}` là hai giá
trị JSON khác nhau, nên dùng lại một key giữa hai body đó là `409 idempotency_key_reuse`, theo §7.

Trả `201` với **payment** được tạo, đúng như `POST /payments` trả về, với `request_id` là request
này. Request chuyển sang `paid` và mang `payment_id` mới.

| Trường hợp | Response |
|---|---|
| Request không ở trạng thái `pending` | 409 `request_not_pending` |
| Số dư của payer nhỏ hơn `amount` | 409 `insufficient_funds` |
| Người gọi không phải payer của request | 403 `forbidden` |
| Request không tồn tại | 404 `not_found` |

Replay một lần trả tiền đã thành công trả về 200 với body payment gốc, kể cả khi request đã là
`paid`. Nó không chuyển thêm tiền và không được trả `409 request_not_pending`.

### `POST /requests/{id}/decline`

Chỉ payer. Không cần idempotency key. Trả `200` với request, `status: "declined"`. Từ chối một
request đã bị từ chối thì trả `200` với trạng thái hiện tại — từ chối hai lần không phải lỗi.
Request đã `paid` hoặc `cancelled` thì trả `409 request_not_pending`. Không phải payer thì trả
`403 forbidden`.

### `POST /requests/{id}/cancel`

Chỉ requester. Không cần idempotency key. Trả `200` với request, `status: "cancelled"`. Hủy một
request đã bị hủy thì trả `200`. Request đã `paid` hoặc `declined` thì trả
`409 request_not_pending`. Không phải requester thì trả `403 forbidden`.

### `GET /requests`

```http
GET /requests?direction=incoming&status=pending&limit=50&offset=0
```

Các request mà người gọi là requester hoặc payer, không có request nào khác. Mới nhất trước,
theo `created_at`.

- `direction` là `incoming` (người gọi là payer), `outgoing` (người gọi là requester) hoặc bỏ
  trống để lấy cả hai.
- `status` là một trong bốn trạng thái, hoặc bỏ trống để lấy tất cả.
- `limit` mặc định 50, phạm vi 1 đến 200. `offset` mặc định 0 và phải từ 0 trở lên. Ngoài phạm vi
  là 422 `validation_failed`. Giá trị `direction` hoặc `status` lạ cũng là 422.
- `has_more` là true khi còn mục sau mục cuối cùng được trả về.

```json
{ "requests": [ { ...request... } ], "has_more": false }
```

### `POST /splits`

**Một đường ghi idempotent.** Chia một khoản tiền mà người gọi đã trả, và yêu cầu từng người tham
gia còn lại trả phần của họ bằng cách tạo cho mỗi người một request `pending`.

```http
POST /splits
Idempotency-Key: 7a3e52...

{ "amount": 3000, "participant_handles": ["ada", "bob", "cy"], "note": "dinner" }
```

Người gọi có thể có mặt trong `participant_handles` hoặc không. Các phần chia theo quy tắc chia
đều ở §9, theo thứ tự handle được đưa vào. **Mỗi người tham gia trừ người gọi được tạo một
request**, mỗi request bằng đúng phần của người đó, với người gọi là requester.

```json
201
{
  "split_id": "sp_2",
  "amount": 3000,
  "currency": "EUR",
  "note": "dinner",
  "shares": [ { "handle": "ada", "amount": 1000 },
              { "handle": "bob", "amount": 1000 },
              { "handle": "cy",  "amount": 1000 } ],
  "requests": [ { ...request for bob... }, { ...request for cy... } ],
  "created_at": "2026-09-24T11:11:00+00:00"
}
```

`shares` gồm mọi người tham gia kể cả người gọi, theo thứ tự đã cho, và luôn có tổng bằng
`amount`. `requests` gồm mọi người tham gia trừ người gọi, theo cùng thứ tự.

| Trường hợp | Response |
|---|---|
| `amount` nhỏ hơn 1, lớn hơn 1000000000, hoặc không phải số nguyên | 422 `validation_failed` |
| `participant_handles` rỗng hoặc chứa handle trùng | 422 `validation_failed` |
| `note` dài hơn 200 ký tự | 422 `validation_failed` |
| Có handle không tồn tại | 404 `not_found` |

Split mà người tham gia duy nhất là người gọi là **hợp lệ**: nó tính một phần, tạo 0 request và
trả `"requests": []`. Không bước nào của split kiểm tra số dư của ai cả.

### `GET /activity`

```http
GET /activity?limit=50&offset=0
```

Các payment mà người gọi được thấy theo hợp đồng feed ở §4, mới nhất trước theo `created_at`.

```json
{ "payments": [ { ...payment... } ], "has_more": false }
```

- Thứ tự tương đối của hai payment được tạo trong cùng một giây là không xác định. Endpoint này
  không yêu cầu phân trang ổn định khi có ghi đồng thời.
- `limit` và `offset` hoạt động giống hệt như trong `GET /requests`.

## 9. Tiền và làm tròn

Các phần chia phải là số nguyên minor unit, tổng đúng bằng `amount` và chênh nhau tối đa một minor
unit. Khi số tiền không chia hết, các phần lớn hơn thuộc về những người đứng đầu theo thứ tự
`participant_handles`.

| `amount` | `n` | Các phần |
|---|---|---|
| 1000 | 3 | 334, 333, 333 |
| 1 | 3 | 1, 0, 0 |
| 10 | 3 | 4, 3, 3 |
| 999 | 3 | 333, 333, 333 |
| 5 | 5 | 1, 1, 1, 1, 1 |

Chia cùng một số tiền cho cùng những người nhưng theo thứ tự `participant_handles` khác thì đơn vị
dư thuộc về người khác. Phần bằng `0` là hợp lệ và vẫn tạo request cho người đó.

Các phần của mỗi split độc lập với các split trước. Sau khi bất kỳ số split nào đã được trả đủ,
tổng số dư các ví vẫn phải bằng đúng tổng được seed.

## 10. Export và import

Service phải hỗ trợ `GET /_test/export` và `POST /_test/import`. Giống reset, đây là các endpoint
test không cần xác thực.
Bản export có thể chứa thông tin đăng nhập và session token; hãy xử lý chúng như dữ liệu test
riêng tư. Export trả 200 với một JSON object chứa `track: "pocketful"`, `format_version: 1` và
`state` (một JSON object do bạn tự định nghĩa). Định dạng state là mờ đối với bên gọi và import
phải chấp nhận nó nguyên trạng.

Import nhận toàn bộ object đó và thay thế state của service một cách nguyên tử, trả 204. Import
phải chấp nhận bản export chưa chỉnh sửa do chính service này tạo ra. Không được phụ thuộc vào
process, file, volume, port hay địa chỉ mạng của nguồn. Import là thay thế, không phải gộp; import
lặp lại sẽ khôi phục state đã export mà không nhân đôi thứ gì. JSON không hợp lệ thì theo §5;
thiếu field, sai track/version hoặc state không hợp lệ thì trả 422 `validation_failed` mà không
thay đổi đích. Các lệnh điều khiển test có timeout 10 giây. Export là một snapshot nguyên tử, chỉ
đọc; các lần ghi về sau ở nguồn không làm thay đổi nó.

Phải giữ nguyên tài khoản và khả năng đăng nhập bằng mật khẩu đã hash, các bearer token hiện có,
loại tiền, số dư, payment, request, quyền hạn, toàn bộ body request idempotent đã hoàn tất và
response gốc của chúng. Không được sinh lại định danh, timestamp và bản ghi tiền, cũng không được
chạy lại chúng lên số dư đã là số ròng. Key của request thất bại vẫn dùng lại được. Biên nhận,
token và retry đã có phải còn hợp lệ sau import; thay state bằng một fixture mới không đáp ứng
yêu cầu này. Import xóa toàn bộ dữ liệu và thông tin đăng nhập cũ ở đích. Reset xóa toàn bộ state,
kể cả state đã import. State không cần tồn tại qua lần container bị khởi động lại đột ngột.

## 11. Settlement ròng nguyên tử

Fixture reset có thể chứa `settlement_operator_ids`, một mảng user id, mặc định []. Operator được
thực hiện settlement trên bất kỳ ví nào. Quyền này không cho phép truy cập request hay mục activity
riêng tư của người dùng khác.

`POST /settlements` cần operator và idempotency key. Không có token thì trả 401; đã xác thực nhưng
không phải operator thì trả 403 `forbidden`. Body:

```json
{"transfers": [{"from_handle": "ada", "to_handle": "bob", "amount": 100},
               {"from_handle": "bob", "to_handle": "cy", "amount": 50}]}
```

`transfers` chứa 1..32 object. Mỗi object dùng các quy tắc thông thường của payment cho amount,
note và visibility (mặc định: note rỗng, public). Handle không tồn tại là 404; tự chuyển cho chính
mình là 422 `self_payment`; lô sai cấu trúc là 422 `validation_failed`. Lỗi của từng mục được ưu
tiên theo thứ tự đầu vào, trước lỗi thiếu tiền. Field lạ bị bỏ qua.

Một settlement chi trả được khi số dư của mọi ví sau tất cả lệnh chuyển vào và ra đều không âm.
Thiếu tiền xét trên toàn lô thì trả 409 `insufficient_funds`. Hoặc mọi lệnh chuyển cùng được ghi,
hoặc không lệnh nào được ghi; validate thất bại thì không chiếm idempotency key và không tạo payment
hay revision nào.

Trả 201 với `settlement_id`, `committed_at` và `payments` theo thứ tự đầu vào. Mỗi thành viên là
một payment bình thường có `settlement_id` liên kết tới lô; payment không thuộc lô nào để field đó
là null. Các thành viên có request_id null và cùng một created_at do server gán, bằng committed_at.

Các payment thành phần tuân theo quy tắc hiển thị activity feed thông thường. Response settlement
chứa biên nhận của mọi thành viên. Replay trả 200 với response đầy đủ gốc. Đây là đường ghi
idempotent thứ năm của stage 1. Reset/import phải giữ quyền settlement operator, payment gốc,
request, thành viên của settlement và response cho retry.
