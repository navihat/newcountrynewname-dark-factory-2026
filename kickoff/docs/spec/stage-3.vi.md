# Pocketful — Stage 3: sao kê và điều chỉnh thanh toán

> **Bản dịch tham khảo để đọc hiểu.** Bản chuẩn là [stage-3.md](stage-3.md) (tiếng Anh, nguyên văn của ban tổ chức).
> Khi giao việc cho band, luôn dán **bản tiếng Anh**, không dán bản này. Tên endpoint, field, mã lỗi và JSON được giữ nguyên.

Các yêu cầu từ stage 1 và 2 vẫn áp dụng, cộng thêm phần bổ sung dưới đây. Các tham chiếu mục đánh
số như §5 và §7 là chỉ `stage-1.md`.

Người dùng có thể xem số dư trong quá khứ và sao kê có phân trang. Người gửi có thể điều chỉnh
(correct) các payment đủ điều kiện mà vẫn giữ nguyên biên nhận gốc. Truy vấn lịch sử phải hỗ trợ cả
ngày có hiệu lực của payment lẫn thông tin mà hệ thống có tại một thời điểm được chỉ định.

## Timestamp của payment

`created_at` của mọi payment là một thời điểm RFC 3339 có offset, cho biết lúc nó chuyển tiền. Mọi
endpoint trả về payment đều có field này. `GET /activity` giữ cách sắp xếp hiện có theo field này.

Payment được seed có thể cung cấp `created_at`; nếu bỏ trống thì dùng thời điểm reset, trước các
payment tạo qua API sau đó. `created_at` được seed nằm trong tương lai thì trả `422 validation_failed`
từ `POST /_test/reset`, không thay đổi state.

`balance` trong fixture vẫn là số dư sau mọi payment được seed. Việc nạp các payment đó không được
làm thay đổi số dư này.

## `GET /me` tại một thời điểm

```http
GET /me?as_of=2026-09-24T13:20:00%2B00:00
```

`as_of` là tùy chọn và là một thời điểm RFC 3339 có offset. Mọi giá trị khác — giờ địa phương không
có múi giờ, chỉ có ngày, giá trị rỗng — là 422 `validation_failed`. Khi không có query parameter
thời gian, response giữ các field tiền hiện có và báo giá trị hiện tại đã điều chỉnh.

Khi có `as_of`, `balance` là số dư của người gọi tại đúng thời điểm đó: số dư sau mọi payment của
họ có `created_at` bằng hoặc trước `as_of`, và trước mọi payment sau đó. Payment xảy ra đúng tại
`as_of` được tính là đã xảy ra.

- `as_of` bằng hoặc sau payment mới nhất thì trả số dư hiện tại.
- `as_of` trước payment sớm nhất thì trả số dư mở đầu — số tiền ví có trước khi có bất kỳ dịch
  chuyển nào.
- Response trả lại `as_of` đúng như đã được gửi lên.

## `GET /statement`

```http
GET /statement?from=<instant>&to=<instant>&limit=50&offset=0
```

Cả `from` và `to` đều tùy chọn; `from` mặc định là thời điểm mở ví và `to` là hiện tại. `limit` và
`offset` hoạt động giống hệt trong `GET /requests`.

Trả về các payment mà người gọi đã gửi hoặc nhận trong cửa sổ nửa mở `[from, to)`, **cũ nhất
trước**, mỗi mục kèm số dư của người gọi ngay sau payment đó:

Ví dụ rút gọn này bỏ qua các field revision và token `snapshot` mô tả bên dưới.

```json
{ "opening_balance": 10000,
  "entries": [
    { "payment": { "...": "..." }, "delta": -500, "balance_after": 9500 },
    { "payment": { "...": "..." }, "delta": 1200, "balance_after": 10700 }
  ],
  "closing_balance": 10700,
  "has_more": false }
```

Yêu cầu của sao kê:

1. Các mục được sắp theo `created_at` tăng dần, nếu bằng nhau thì theo `id` payment tăng dần.
2. `opening_balance` là số dư ngay trước `from`. `closing_balance` là số dư ngay trước `to`.
3. `opening_balance` cộng mọi giá trị `delta` trong toàn bộ cửa sổ phải bằng `closing_balance`.
   Payment gửi đi có `delta` âm; payment nhận được có `delta` dương.
4. Phân trang không được làm thay đổi `balance_after` của một mục hay số dư mở đầu/kết thúc của cửa
   sổ. Các giá trị này mô tả toàn bộ cửa sổ, bất kể `limit` và `offset`.

Chỉ payment do người gọi gửi hoặc nhận mới xuất hiện trong sao kê của họ, kể cả khi có payment khác
là public. Quy tắc hiển thị của activity feed không áp dụng cho sao kê.

## Thời điểm hiệu lực, thời điểm ghi nhận, và điều chỉnh

Service phải phân biệt **khi nào tiền có hiệu lực** với **khi nào service biết được điều đó**. Mỗi
payment có một lịch sử revision. Revision 1 có `amount` như lúc trả ban đầu và
`effective_at = recorded_at = created_at`. `created_at` được cung cấp của payment seed cũng là thời
điểm ghi nhận/hiệu lực gốc của nó; bỏ trống thì dùng thời điểm reset. Số dư mở đầu bằng số dư cuối
được seed trừ đi tác động ròng của các payment gốc được seed. Điều chỉnh không được làm thay đổi các
số dư mở đầu đó. Tài khoản mới mở với số dư 0. Lịch sử được seed nhất quán và không âm.

`POST /payments/{payment_id}/corrections` cần idempotency key và phải do người gửi gốc gọi. Người đã
xác thực nhưng không phải người gửi nhận 403 `forbidden`; payment không tồn tại thì 404. Body:

```json
{"expected_revision": 1, "amount": 400,
 "effective_at": "2026-09-20T12:00:00+00:00", "reason": "corrected amount"}
```

Mọi field đều bắt buộc. Revision là số nguyên dương; amount là số nguyên 0..1000000000 (bằng 0 là
đảo ngược toàn bộ payment); reason là chuỗi 1..200 ký tự; thời điểm hiệu lực là thời điểm RFC 3339
không muộn hơn hiện tại. Đầu vào không hợp lệ là 422 `validation_failed`. Điều chỉnh không đổi các
bên tham gia hay chế độ hiển thị. Nó thêm một revision bất biến, trả 201 với `payment_id`,
`revision`, `amount`, `effective_at`, `recorded_at` do server gán, và `reason`. Thời điểm ghi nhận
của một payment tăng ngặt. Expected revision đã cũ thì trả 409 `stale_revision`. Replay thành công
trả về revision gốc đó với 200, kể cả khi đã có revision mới hơn. Khác body mà cùng key là
409 `idempotency_key_reuse`.

Phần chênh lệch so với số tiền trước đó được chuyển giữa **đúng hai ví đó** trong cùng một bước
nguyên tử. Tăng số tiền thì trừ tiền người gửi gốc; giảm số tiền thì trừ tiền người nhận gốc. Khoản
trừ mà hiện tại không đủ tiền thì trả 409 `insufficient_funds`. Nếu không, mà số dư đã điều chỉnh
của bất kỳ người dùng nào bị âm tại bất kỳ mốc thời gian hiệu lực nào, thì trả
409 `historical_overdraft`. Số dư tại một mốc tính tác động gộp của mọi dịch chuyển tại thời điểm
đó. Thất bại nào cũng giữ nguyên số dư, lịch sử revision, sao kê và state idempotency. Tổng số dư
phải bằng tổng được seed ở mọi góc nhìn lịch sử.

Payment gốc và mọi response idempotent gốc giữ nguyên. `GET /activity` vẫn hiển thị payment gốc;
bản ghi điều chỉnh không phải payment mới trong feed. `GET /payments/{payment_id}/revisions` trả
`{"revisions": [...]}` theo thứ tự revision, gồm cả revision 1 (`reason: ""`). Chỉ hai bên được đọc;
bên thứ ba nhận 404 kể cả với payment public. Không có token thì 401.

`GET /me` và `GET /statement` nhận tham số tùy chọn `known_at`, một thời điểm RFC 3339 có offset.
Với mỗi payment, chọn revision mới nhất được ghi nhận **bằng hoặc trước** `known_at`; nếu chưa có
revision nào được ghi nhận thì payment đó không đóng góp gì. Bỏ trống nghĩa là mọi thứ đã biết lúc
bắt đầu đọc. Sau đó áp dụng các revision đã chọn theo thời điểm **hiệu lực** của chúng. `as_of` giữ
nghĩa tính cả thời điểm đó; sao kê giữ cửa sổ nửa mở. Cả hai thời điểm truy vấn đều có thể nằm trong
tương lai. Thời điểm không hợp lệ hoặc rỗng là 422. Trả lại `known_at` đúng như đã được gửi lên.

Sao kê giờ sắp theo `effective_at` đã chọn, rồi theo id payment. Mỗi mục giữ `payment`, `delta` và
`balance_after`, và thêm `revision`, `effective_at` và `recorded_at` đã chọn. `payment.amount` là
số tiền đã chọn cho sao kê này. Revision có số tiền bằng 0 vẫn xuất hiện như một mục với delta bằng
0. Không bao giờ tính một điều chỉnh song song với revision mà nó thay thế. Khi không có điều chỉnh
và không có `known_at`, hành vi cũ không đổi.

## Phân trang sao kê ổn định

Mọi response `GET /statement` đầu tiên trả thêm một token mờ `snapshot`. Nó đóng băng các revision
đã chọn, cửa sổ, số dư, các mục và giá trị `to` mặc định của người gọi tại lần đọc đó.
`GET /statement?snapshot=<token>&limit=...&offset=...` phân trang đúng kết quả đó, kể cả sau khi có
payment hay điều chỉnh mới. Chỉ limit và offset được đi kèm snapshot; truyền `from`, `to` hoặc
`known_at` cùng snapshot thì trả 422 `validation_failed`. Token không tồn tại, token của người khác,
hoặc token từ trước lần reset thì trả 404 `not_found`. Token tồn tại cho tới lần reset. Không yêu
cầu lưu trữ qua lần khởi động lại container. Phân trang không làm thay đổi số dư hay các mục; trang
cuối không đầy và offset vượt quá cuối phải báo `has_more` chính xác. Query parameter lạ vẫn bị bỏ
qua theo quy tắc chung của stage 1.

Một điều chỉnh có thể đưa payment vào hoặc ra khỏi một cửa sổ sao kê. Snapshot đã có giữ nguyên khi
có payment hay điều chỉnh đồng thời. Hai điều chỉnh đồng thời dùng cùng một expected revision không
thể cùng thành công.

## Lịch sử settlement

Settlement của stage 1 giữ nguyên biên nhận gốc và quy tắc riêng tư. Revision gốc của mỗi thành
viên dùng `committed_at` chung làm cả effective_at lẫn recorded_at. Điều chỉnh một payment riêng lẻ
từ chối thành viên settlement với 422 `linked_payment_immutable`.

Service stage 3 phải chấp nhận bản export do service stage 1 hoặc stage 2 của cùng đội tạo ra. Sổ
cái phải import và tính đến các authorization và capture. Capture là payment liên kết bất biến:
điều chỉnh một capture trả 422 `linked_payment_immutable`.

## Hold trong quá khứ

Với `GET /me?as_of=T&known_at=K`, cả bốn field tiền mô tả cùng một góc nhìn:
`balance = total`, `available = total - held`. Một hold bắt đầu lúc tạo authorization; capture không
cuối làm giảm nó tại thời điểm capture; capture cuối, void hoặc hết hạn trả lại phần còn lại tại
thời điểm của sự kiện đó. Hết hạn có hiệu lực tại `expires_at`. Các sự kiện khác ngoài hết hạn theo
đồng hồ được coi là đã biết tại thời điểm sự kiện do server gán. Khi đã biết lúc tạo thì cũng biết
luôn hạn chót hết hạn. Với truy vấn vượt quá hiện tại, hold đang mở hết hạn tại hạn chót của nó.
Không có `as_of` thì dùng thời điểm request bắt đầu. Authorization có thêm `closed_at` (null khi
đang mở; là thời điểm sự kiện khi đã đóng).

`total` trong quá khứ tuân theo quy tắc thời điểm hiệu lực/ghi nhận của stage 3. Một điều chỉnh bị
từ chối với 409 `historical_overdraft` nếu nó làm total hoặc available bị âm tại bất kỳ mốc hiệu
lực/sự kiện nào trong quá khứ, theo các revision mới nhất đã biết. Khoản trừ hiện tại không đủ tiền
vẫn được ưu tiên trả `insufficient_funds`. Hold đang mở được seed được coi là tạo lúc reset trừ khi
có cung cấp `created_at`; hold đã đóng được seed không cần tái dựng vòng đời trước đó.
`GET /statement` vẫn chỉ chứa các dịch chuyển tiền: authorization, việc trả lại và hết hạn không
phải payment. Capture xuất hiện đúng một lần cùng liên kết của nó. Snapshot cũ giữ nguyên sau mọi
hành động trong vòng đời hold hay điều chỉnh.
