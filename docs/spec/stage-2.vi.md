# Pocketful — Stage 2: giao diện ví và authorization thanh toán

> **Bản dịch tham khảo để đọc hiểu.** Bản chuẩn là [stage-2.md](stage-2.md) (tiếng Anh, nguyên văn của ban tổ chức).
> Khi giao việc cho band, luôn dán **bản tiếng Anh**, không dán bản này. Tên route, field, `data-testid`, mã lỗi và JSON được giữ nguyên.

Các yêu cầu của stage 1 vẫn áp dụng, cộng thêm phần bổ sung dưới đây. Các tham chiếu mục đánh số
như §5 và §7 là chỉ `stage-1.md`.

Người dùng có thể quản lý payment, request và chia hóa đơn trên trình duyệt. Họ cũng có thể giữ
trước (reserve) tiền cho một người nhận để người đó thu sau, trong một hoặc nhiều lần capture.

Các màn hình sau phải truy cập được bằng URL. Các màn hình khác phải truy cập được qua giao diện.
Render phía server và phía client đều được phép.

| Route | Màn hình |
|---|---|
| `/` | Số dư, form trả tiền, form yêu cầu trả tiền và activity feed |
| `/requests` | Request đến và đi, với các nút trả, từ chối và hủy |
| `/split` | Form chia hóa đơn |
| `/signup` | Đăng ký |
| `/login` | Đăng nhập |

Trình duyệt và API dùng chung `/requests`. Trả giao diện khi request có `Accept: text/html`;
request API không có header đó nhận JSON.

Giao diện phải có các thuộc tính `data-testid` liệt kê dưới đây để phục vụ test tích hợp. Được
phép có thêm phần tử khác, và cách thể hiện về mặt thị giác do đội tự chọn, miễn đáp ứng các yêu
cầu chất lượng sản phẩm bên dưới.

## Định hướng sản phẩm và thị giác

Trải nghiệm trên trình duyệt phải giống một sản phẩm tài chính tiêu dùng mạch lạc, đủ để đem đi
trình bày, chứ không phải một công cụ test gắn thêm vài nút bấm. Hướng tới cảm giác điềm tĩnh,
đáng tin. Khi đã có hold, số tiền khả dụng phải là con số nổi bật nhất, còn tổng tiền và tiền đang
bị giữ hiển thị ở mức phụ. Payment, request, split và authorization phải dễ lướt qua, và người dùng
hiểu được trạng thái, chiều tiền, tính riêng tư và dòng tiền mà không cần đọc dữ liệu API thô.

Dùng một hệ thống thị giác nhất quán cho chữ, khoảng cách, màu sắc, control và phản hồi. Hành động
chính phải dễ nhận ra. Các trạng thái khả dụng, đang giữ, đang chờ, đang tải, thành công, bị từ
chối và không chắc chắn phải khác biệt rõ về thị giác, đồng thời đáp ứng các yêu cầu hành vi bên
dưới. Định dạng tên người, số tiền và thời gian sao cho thân thiện với con người; chỉ hiển thị định
danh kỹ thuật ở chỗ nó giúp ích cho người dùng.

Các luồng bắt buộc phải rõ ràng, dùng được ở viewport 375 CSS pixel và ở độ rộng desktop thông
thường, không có cuộn ngang trang. Ô nhập cần label hiển thị, focus bàn phím phải dễ thấy, chữ và
control cần đủ độ tương phản. Thiết kế chu đáo các trạng thái rỗng, đang tải và lỗi, và giữ điều
hướng nhất quán giữa các route bắt buộc. Không bắt buộc có hình minh họa riêng, tài sản thương hiệu
hay khớp chính xác với một thiết kế tham chiếu.

## Đăng ký và đăng nhập

| `data-testid` | Phần tử |
|---|---|
| `signup-email`, `signup-password`, `signup-display-name` | Ô nhập |
| `signup-submit` | Nút |
| `login-email`, `login-password`, `login-submit` | Ô nhập và nút |
| `auth-error` | Thông báo lỗi. Chỉ có mặt khi có lỗi |
| `current-user` | Hiển thị trên mọi màn hình khi đã đăng nhập. Nội dung chứa display name |
| `current-handle` | Nội dung đúng bằng handle của người gọi, không có `@` và không có chữ nào xung quanh |
| `logout-button` | Nút |

## Số dư và trả tiền — `/`

| `data-testid` | Phần tử |
|---|---|
| `wallet-balance` | Nội dung đúng bằng số tiền đã định dạng. Mang `data-amount="{minor units}"` |
| `pay-handle`, `pay-amount`, `pay-note` | Ô nhập. `pay-amount` là chuỗi **thập phân** như người dùng gõ, ví dụ `15.00` |
| `pay-visibility` | Chọn `public` hoặc `private`. Giá trị option là đúng hai chuỗi đó |
| `pay-submit` | Nút |
| `pay-error` | Thông báo lỗi khi payment bị từ chối — kể cả thiếu tiền |
| `request-handle`, `request-amount`, `request-note`, `request-submit` | Form yêu cầu trả tiền |
| `request-error` | Thông báo lỗi khi request bị từ chối |

Giữ nguyên giá trị trong form trả tiền sau khi thành công. Gửi lại form mà không đổi field nào thì
không được gửi thêm payment: `wallet-balance` chỉ giảm một lần, feed chỉ có một payment và
`pay-error` không xuất hiện. Đổi một field thì lần gửi tiếp theo là một yêu cầu thanh toán mới.
Retry theo §7.

**Số tiền đã định dạng.** `wallet-balance` là số thập phân với đúng `minor_units` chữ số lẻ, một
dấu cách, rồi mã tiền tệ: `100.00 EUR`. Với `minor_units` là `0` thì không có dấu chấm thập phân:
`1200 JPY`. Số dư không bao giờ âm nên không có dấu.

Form nhận số tiền thập phân và gửi minor unit lên API. Với `minor_units: 2`, `15.00` và `15` đều gửi
`1500`; `15.5` gửi `1550`. Nhập ký tự không phải số hoặc nhiều hơn `minor_units` chữ số lẻ thì phải
hiện phần tử lỗi của form mà không gửi request. Ví dụ `15.005` bị từ chối chứ không được làm tròn.

## Activity feed — `/`

| `data-testid` | Phần tử |
|---|---|
| `activity-list` | Container. Các phần tử con xếp mới nhất trước trong DOM |
| `activity-item-{payment_id}` | Mỗi payment nhìn thấy được có một mục. Mang `data-visibility="public"` hoặc `data-visibility="private"` |
| `activity-parties-{payment_id}` | Nội dung chứa cả hai handle |
| `activity-amount-{payment_id}` | Nội dung đúng bằng số tiền đã định dạng |
| `activity-note-{payment_id}` | Nội dung đúng bằng note. Có mặt cả khi note rỗng |
| `empty-activity` | Hiển thị thay cho danh sách khi không có gì để thấy |

Hai payment cùng timestamp có thể xuất hiện theo thứ tự bất kỳ.

## Request — `/requests`

| `data-testid` | Phần tử |
|---|---|
| `incoming-list`, `outgoing-list` | Container |
| `request-item-{request_id}` | Mỗi request một mục. Mang `data-status="{status}"` |
| `request-amount-{request_id}` | Nội dung đúng bằng số tiền đã định dạng |
| `request-pay-{request_id}` | Nút. Chỉ có trên request đến đang `pending` |
| `request-decline-{request_id}` | Nút. Chỉ có trên request đến đang `pending` |
| `request-cancel-{request_id}` | Nút. Chỉ có trên request đi đang `pending` |
| `request-error` | Hiển thị khi việc trả, từ chối hoặc hủy bị từ chối |
| `empty-requests` | Hiển thị khi cả hai danh sách đều rỗng |

## Split — `/split`

| `data-testid` | Phần tử |
|---|---|
| `split-amount` | Ô nhập thập phân, cùng quy tắc với `pay-amount` |
| `split-handles` | Ô nhập văn bản: các handle cách nhau bằng dấu phẩy, theo thứ tự |
| `split-note`, `split-submit` | Ô nhập và nút |
| `split-preview` | Hiển thị các phần đã tính trước khi gửi. Chứa một `split-share-{handle}` cho mỗi người tham gia |
| `split-share-{handle}` | Nội dung đúng bằng số tiền của phần đó đã định dạng |
| `split-error` | Thông báo lỗi khi split bị từ chối |

`split-preview` phải hiển thị đúng các phần mà server sẽ tính theo quy tắc ở `stage-1.md` §9, trước
khi gửi bất cứ thứ gì. Bản xem trước và split được gửi phải có các phần giống hệt nhau.

Sau mọi hành động thành công, số dư, feed và danh sách request trên cùng trang phải hiển thị state
mới mà không cần tải lại trang thủ công. Việc điều hướng phải chờ thao tác ghi thành công rồi mới
làm mới dữ liệu. Cơ chế nào cũng được, kể cả điều hướng toàn trang. **Ở đây không yêu cầu cập nhật
trực tiếp (live update)** — client khác có thể thay đổi state, nhưng trình duyệt này chỉ cần làm
mới sau hành động của chính nó hoặc khi người dùng chủ động làm mới.

## Client cạnh tranh và kết quả không chắc chắn

- Thêm `wallet-refresh`, một nút trên `/` để làm mới số dư và feed mà không xóa form trả tiền.
  **Lần làm mới mới nhất thắng:** một lần đọc cũ bị chậm không được ghi đè lên lần làm mới sau,
  kể cả khi response về sai thứ tự.
- Client khác có thể tiêu số dư sau khi trình duyệt này đọc nó. Payment bị từ chối thì hiện
  `pay-error`, làm mới số dư/feed, và giữ nguyên mọi ô nhập của form trả tiền. Request bị hủy ở
  nơi khác trong lúc nút trả của nó vẫn đang hiển thị thì phải hiện `request-error` khi việc trả bị
  từ chối, và làm mới danh sách request để nút trả đã cũ biến mất.
- Nếu response của payment bị mất, kể cả sau khi `POST /payments` đã ghi xong, thì hiện
  `pay-uncertain` (có nội dung), không hiện `pay-error`. Giữ form không đổi để retry được với **cùng
  key và cùng body**. Retry thành công thì xóa cả phần tử lỗi lẫn phần tử không chắc chắn, làm mới
  số dư và feed, và tiền chỉ được chuyển đúng một lần. Kết quả chưa biết không phải là từ chối đã
  được xác nhận.

Không yêu cầu polling ngầm, đồng bộ trực tiếp hay khôi phục qua lần tải lại trang. Quy tắc làm mới
số dư như trên cũng áp dụng cho số tiền khả dụng và số tiền đang bị giữ được giới thiệu bên dưới.

## Client đang dùng sau khi nâng cấp

Service stage 2 phải chấp nhận bản export do service stage 1 của cùng đội tạo ra. Trình duyệt đã
đăng nhập trước lần nâng cấp bằng export/import phải vẫn đăng nhập sau đó. Các request đang pending
vẫn trả được qua màn hình request. Một payment bị mất response trước khi export vẫn retry được sau
import với cùng body và key; giao diện phải khôi phục payment gốc và làm mới số dư đã import. Các
yêu cầu này áp dụng khi import hoàn tất giữa hai request của trình duyệt; không yêu cầu migrate
trong lúc một request đang chạy. Không yêu cầu tải lại trang hay chuyển màn hình. Form và định danh
của retry đang chờ phải tồn tại qua lần nâng cấp.

## Authorization và capture

Một khoản thanh toán có thể được **authorise** (cấp phép) bây giờ và **capture** (thu) sau, toàn
bộ hoặc ít hơn. Một authorization đặt một *hold* (khoản giữ) lên ví của payer: nó giữ tiền mà không
chuyển tiền. Capture mới chuyển tiền; một lần capture cuối (final) đồng thời trả lại phần chưa thu.
Capture không cuối (nonfinal) giữ phần còn lại tiếp tục bị giữ. Authorization đang mở sẽ tự hết hạn
và trả lại phần còn lại.

1. Tổng `total` của mọi ví luôn bằng tổng được seed ở lần reset gần nhất. Hold không chuyển tiền;
   payment, settlement và capture chuyển tiền giữa các ví.
2. `available = total − held` không bao giờ được âm. Tiền đang bị giữ không dùng được để trả
   payment mới, tạo authorization mới hay chi phần nợ ròng của settlement. Capture được tiêu chính
   số tiền đã được giữ cho nó.
3. Tổng các lần capture không được vượt số tiền đã authorise. Mỗi lần capture idempotent chỉ chuyển
   tiền một lần. Hold đã đóng thì không capture lại được.

API hiện có thay đổi như sau:

- `GET /me` giữ `balance`, và `balance` **bằng `total`**. `available` và `held` là field mới bên
  cạnh. Khi không có hold đang mở, `balance`, `total` và `available` bằng nhau, `held` bằng 0, và
  mọi hành vi cũ không đổi.
- `POST /payments` vẫn là chuyển tiền ngay lập tức. Nó không được để lại hold trung gian hay đòi một
  bước capture riêng.
- Mọi `409 insufficient_funds` ở stage 1 — trên `POST /payments`, `POST /requests/{id}/pay` và
  settlement — giờ được xét theo `available`. Khi không có hold đang mở, kết quả không đổi.
- Trả request vẫn là ngay lập tức. Authorise một request nằm ngoài phạm vi.
- `POST /splits` không đổi.
- Giờ có bảy đường ghi idempotent: năm đường của stage 1, authorization và capture. Cùng quy tắc
  replay áp dụng độc lập cho từng đường.

## Mô hình

Fixture có thêm thời hạn mặc định cho toàn service và một mảng `authorizations`.

```json
{
  "currency": "EUR",
  "minor_units": 2,
  "authorization_ttl_seconds": 600,
  "users": [ { "id": "u_ada", "handle": "ada", "balance": 10000, "...": "..." } ],
  "authorizations": [
    { "id": "a_1", "from_user_id": "u_ada", "to_user_id": "u_bob",
      "amount": 2000, "note": "deposit", "visibility": "public",
      "status": "open", "expires_at": "2026-09-24T13:20:00+00:00" }
  ]
}
```

- `authorization_ttl_seconds` áp dụng cho mọi authorization tạo qua API. Mặc định 600 khi bỏ trống.
  Nếu có thì phải là số nguyên dương (giây). Authorization được seed mang `expires_at` tuyệt đối
  riêng của nó.
- `balance` được seed của người dùng vẫn là `total`. **`available` là giá trị suy ra, không bao giờ
  được seed** — service tự trừ đi các hold đang mở được seed.
- Tổng các hold đang mở, chưa hết hạn được seed lớn hơn `balance` của người dùng đó là lỗi reset:
  `422 validation_failed` từ `POST /_test/reset`, không thay đổi gì, giống hệt trường hợp số dư seed
  bị âm.
- `status` được seed là `open`, `captured`, `voided` hoặc `expired`. Chỉ `open` mới giữ tiền.
- Fixture cũ có thể bỏ hẳn `authorizations`; bỏ trống nghĩa là danh sách rỗng.

Authorization có `expires_at` bằng hoặc trước thời điểm hiện tại là `expired` và không giữ tiền.
Các lần đọc và ghi phải phản ánh việc hết hạn kể cả khi không có request nào xảy ra đúng lúc hết
hạn. `GET /authorizations` phải hiện `status: "expired"`, và `GET /me` phải tính phần đã được trả
lại vào `available`. Thời điểm hết hạn được seed cách thời điểm reset ít nhất một giờ, có thể trong
quá khứ hoặc tương lai; authorization mới tạo có thể có thời hạn ngắn hơn.

## API

### `GET /me`

```json
{ "user_id": "u_ada", "display_name": "Ada", "handle": "ada",
  "balance": 10000, "total": 10000, "available": 8000, "held": 2000,
  "currency": "EUR", "minor_units": 2 }
```

`balance` và `total` luôn bằng nhau. `held` là tổng các hold đang mở, và `available` là
`total − held`, không bao giờ âm.

### `POST /authorizations`

Bắt buộc có `Idempotency-Key`. Người gọi là payer.

```json
{ "to_handle": "bob", "amount": 2000, "note": "deposit", "visibility": "private" }
```

`note` và `visibility` là tùy chọn, với cùng giá trị mặc định như `POST /payments`.

```json
201
{
  "authorization_id": "a_4",
  "from_user_id": "u_ada", "from_handle": "ada",
  "to_user_id": "u_bob", "to_handle": "bob",
  "amount": 2000,
  "captured_amount": 0,
  "currency": "EUR",
  "note": "deposit",
  "visibility": "private",
  "status": "open",
  "expires_at": "2026-09-24T13:20:00+00:00",
  "payment_id": null,
  "created_at": "2026-09-24T13:10:00+00:00"
}
```

`expires_at` là `created_at` cộng `authorization_ttl_seconds`.

| Trường hợp | Response |
|---|---|
| `available` của người gọi nhỏ hơn `amount` | 409 `insufficient_funds` |
| `amount` nhỏ hơn 1, lớn hơn 1000000000, hoặc không phải số nguyên | 422 `validation_failed` |
| `to_handle` là handle của chính người gọi | 422 `self_payment` |
| `note` quá 200 ký tự, hoặc `visibility` không phải `public` hay `private` | 422 `validation_failed` |
| Không có người dùng nào mang handle đó | 404 `not_found` |

Authorization đang mở **không** phải một mục trong feed và không bao giờ xuất hiện trong
`GET /activity`.

### `POST /authorizations/{id}/capture`

Bắt buộc có `Idempotency-Key`. Chỉ người nhận (bên `to`) được capture.

```json
{ "amount": 1500 }
```

`amount` là tùy chọn, mặc định là phần còn lại của authorization. Giống `POST /requests/{id}/pay`,
**replay phải gửi body giống hệt** — `{}` và `{"amount": 2000}` là hai giá trị JSON khác nhau dù
cùng nghĩa một lần capture, nên dùng lại một key giữa hai body đó là 409 `idempotency_key_reuse`
theo `stage-1.md` §7.

Trả `201` với **payment** được tạo, đúng cấu trúc `POST /payments` trả về, với `authorization_id` là
authorization này và `request_id: null`. `amount` của payment là số tiền đã capture; `note` và
`visibility` được sao chép từ authorization; payment xuất hiện trong activity feed theo quy tắc hiển
thị thông thường. Payment tạo ra không qua authorization mang `authorization_id: null`; ý nghĩa
`request_id` hiện có của chúng không đổi.

Mặc định, authorization chuyển sang `captured`, mang `captured_amount` và `payment_id`, và **trả lại
ngay phần chưa capture**: capture 1500 trên 2000 thì trả 500 về `available` của payer trong cùng một
bước.

**Mặc định: mỗi authorization một lần capture cuối.** Capture lần hai sau một lần capture cuối là
`409 authorization_not_open`.

**Chế độ capture mở rộng.** Để giữ phần còn lại tiếp tục bị giữ, gửi
`{"amount": 700, "final": false}`. `final` là boolean, mặc định `true`, nên các request capture một
lần như trước vẫn giữ hành vi cũ. Với `final: false` và còn phần chưa capture, trạng thái vẫn là
`open`; được capture tiếp cho tới hết phần còn lại. Capture toàn bộ phần còn lại thì đóng
authorization kể cả khi `final: false`. Capture cuối thì đóng authorization và trả lại phần còn lại.
`capture_exceeds_authorization` so với **phần còn lại**; bỏ trống amount thì mặc định bằng phần còn
lại đó. `captured_amount` là tổng cộng dồn; `payment_id` là lần capture mới nhất; `payment_ids` liệt
kê mọi lần capture theo thứ tự. Mọi response authorization có thêm `remaining_amount`: số tiền vẫn
đang bị giữ, bằng 0 khi đã đóng. Void và hết hạn có thể đóng một authorization đã capture một phần,
chỉ trả lại phần còn lại và giữ nguyên mọi bản ghi capture. Các field mới không thay đổi cách so
sánh body cho idempotency.

| Trường hợp | Response |
|---|---|
| Authorization không ở trạng thái `open` | 409 `authorization_not_open` |
| `expires_at` bằng hoặc trước thời điểm hiện tại | 409 `authorization_expired` |
| `amount` lớn hơn phần chưa capture của authorization | 422 `capture_exceeds_authorization` |
| `amount` nhỏ hơn 1 hoặc không phải số nguyên | 422 `validation_failed` |
| Người gọi không phải người nhận | 403 `forbidden` |
| Authorization không tồn tại | 404 `not_found` |

### `POST /authorizations/{id}/void`

**Chỉ payer được void** — bên `from` tự giải phóng hold của mình. Không cần idempotency key, giống
decline và cancel.

Trả `200` với authorization, `status: "voided"`, hold được giải phóng. Void một authorization đã
voided thì trả `200` với trạng thái hiện tại. Authorization đã `captured` hoặc `expired` thì trả
`409 authorization_not_open`.

Với một authorization có tồn tại, capture và void trả 403 `forbidden` khi người gọi không phải bên
được phép, kể cả người không thuộc bên nào. `GET /authorizations` chỉ trả các authorization có liên
quan tới người gọi.

### `GET /authorizations`

```http
GET /authorizations?direction=outgoing&status=open&limit=50&offset=0
```

Các authorization mà người gọi là payer hoặc người nhận, không có authorization nào khác. Mới nhất
trước theo `created_at`.

- `direction` là `outgoing` (người gọi là payer), `incoming` (người gọi là người nhận), hoặc bỏ trống
  để lấy cả hai.
- `status` là một trong bốn trạng thái, hoặc bỏ trống để lấy tất cả. Authorization hết hạn do đồng
  hồ khớp với `expired`, không bao giờ khớp với `open`.
- `limit`, `offset` và `has_more` hoạt động giống hệt trên `GET /requests`.

## Giao diện

Có route mới `/authorizations`, và ví có thêm hai con số. Giao diện và API dùng chung
`/authorizations`: trả HTML cho `Accept: text/html` và JSON trong các trường hợp khác, giống như
`/requests`.

| `data-testid` | Phần tử |
|---|---|
| `wallet-balance` | `total` đã định dạng, giữ nguyên cách hiển thị và `data-amount` hiện có |
| `wallet-available` | `available` đã định dạng, có `data-amount`. **Trình bày đây là con số chính** — đó là số người dùng thực sự tiêu được |
| `wallet-held` | `held` đã định dạng, có `data-amount`. Không có mặt khi `held` bằng 0 |
| `authorize-handle`, `authorize-amount`, `authorize-note`, `authorize-visibility`, `authorize-submit` | Form authorise. Cùng quy tắc nhập liệu như form trả tiền |
| `authorize-error` | Hiển thị khi authorization bị từ chối, kể cả thiếu tiền khả dụng |
| `authorization-list` | Container trên `/authorizations`. Phần tử con mới nhất trước trong DOM |
| `authorization-item-{authorization_id}` | Mang `data-status="{status}"` |
| `authorization-amount-{id}` | Nội dung đúng bằng số tiền đã authorise, đã định dạng |
| `authorization-captured-{id}` | Số tiền đã capture, đã định dạng. Chỉ có khi `status` là `captured` |
| `authorization-expires-{id}` | Nội dung là `expires_at` dạng RFC 3339 |
| `authorization-capture-amount-{id}` | Ô nhập thập phân, điền sẵn phần còn lại. Chỉ có trên authorization đến đang `open` |
| `authorization-capture-{id}` | Nút. Chỉ có trên authorization đến đang `open` |
| `authorization-void-{id}` | Nút. Chỉ có trên authorization đi đang `open` |
| `authorization-error` | Hiển thị khi capture hoặc void bị từ chối |
| `empty-authorizations` | Hiển thị khi danh sách rỗng |

Giao diện phải phản ánh cả hold được seed lẫn hold mới tạo. Hiển thị tiền khả dụng là số dư chi tiêu
của người dùng, kể cả ngay sau reset khi có hold đang mở.

## Thao tác đồng thời

Các request đồng thời phải cho cùng kết quả như khi thực hiện lần lượt từng cái theo một thứ tự nào
đó, và các yêu cầu ở trên phải đúng ở mọi lần đọc.
