# Tổng hợp thông tin — WeAreDevelopers x BAND: AI Dark Factory (hackathon edition)

> **Track đã chọn: 💸 pocketful (ví & thanh toán).**
>
> **Mục đích:** bản tiếng Việt để đọc, có cùng nội dung với `AGENT_CONTEXT.md` (bản tiếng Anh dành cho agent tư vấn/lập kế hoạch).
> **Đây KHÔNG phải mandate.** Không đưa file này vào chỉ dẫn cố định của bất kỳ seat nào trong BAND, vì mandate chứa chi tiết riêng của track sẽ khiến bài bị loại (xem §6.1).
>
> **Nguồn chuẩn:** `OFFICIAL_SOURCES.md` (nguyên văn participant guide + toàn bộ spec pocketful + danh sách từ cấm trong mandate, commit `803560d` của repo, 26/09/2026). File này chỉ là tóm tắt; nếu có khác biệt thì theo file chính thức. Luôn dán **toàn văn** spec của stage vào room, không dán bản tóm tắt.
>
> Nguồn (lấy ngày 02/10/2026):
> - https://lablab.ai/ai-hackathons/wearedevelopers-hackathon
> - https://www.band.ai/hacker-guide
> - https://docs.band.ai/band-desktop (trước đây là `docs.band.ai/jam`)
> - https://github.com/band-ai/dark-factory-wearedevs (gói kickoff; `docs/participant-guide.md` là bản chính thức)

---

## 1. Thông tin chính

| Mục | Nội dung |
|---|---|
| Tên | WeAreDevelopers x BAND present: Dark Factory (hackathon edition) |
| Tổ chức | BAND (đơn vị trình bày), WeAreDevelopers World Congress North America, lablab.ai |
| Hình thức | Online hoàn toàn, toàn cầu, miễn phí |
| Thời gian build | 26/9 – 5/10/2026 · Kickoff 09:00 PDT · **Đóng 23:59 PDT ngày 5/10** (= **13:59 ngày 6/10 giờ Việt Nam**) |
| Số người/đội | 1–6 |
| Tổng giải | $6.000 tiền mặt chia cho 2 track, cộng $300 credit Featherless cho đội thắng đầu tiên |
| Nơi tham gia | lablab.ai (đăng ký) + Discord lablab + Discord BAND |
| Spec chi tiết | Trong repo starter: `pocketful/spec/stage-1..4.md` (tóm tắt ở §4). Giới hạn: 2 vCPU, 2 GiB, 50 request đồng thời, 5 s/request |
| Repo starter | https://github.com/band-ai/dark-factory-wearedevs (commit `803560d`, 26/09/2026). Clone về để chạy harness; **không** nộp bài vào repo này |
| Quà thêm | Người đăng ký đủ điều kiện nhận vé miễn phí WeAreDevelopers World Congress NA (San Jose, 23–25/9) |

---

## 2. Thử thách

Xây một **nhà máy phần mềm** (software factory) trong **BAND Desktop**. Đây là một nhóm ("band") coding agent có khả năng:
1. lập kế hoạch,
2. triển khai,
3. bàn giao kèm bằng chứng,
4. tự kiểm tra kết quả một cách độc lập.

Sau đó dùng nhà máy này để làm ra **bản sao clean-room** của một sản phẩm quen thuộc. Con người chỉ giao việc và quyết định có chấp nhận kết quả hay không.

**Bài nộp gồm: nhà máy + lượt chạy tạo ra kết quả + kết quả.**

Cấu trúc: 2 track, **4 stage được chấm điểm**, làm trong 1 tuần. Nhà máy phải xây được service, sửa được lỗi, và mở rộng những gì đã xây mà không làm hỏng phần đang chạy.

### 2.1 Track đã chọn: 💸 pocketful

Bản sao clean-room của ứng dụng ví & thanh toán (giống Venmo): người dùng giữ tiền trong ví, gửi tiền theo handle, yêu cầu người khác trả tiền và chia hóa đơn. Các khoản thanh toán hiện trong activity feed công khai/riêng tư. Bạn chỉ cạnh tranh với các đội cùng track pocketful.

Spec cấm dùng source code, tài liệu API hay schema của các sản phẩm có sẵn trong lĩnh vực này.

---

## 3. Repo starter chính thức (gói kickoff)

Repo: https://github.com/band-ai/dark-factory-wearedevs — **`docs/participant-guide.md` là bộ luật chính thức**, ưu tiên hơn trang lablab nếu có khác biệt.

| Đường dẫn | Nội dung |
|---|---|
| `docs/participant-guide.md` | Luật, lịch trình, gate, rubric, hướng dẫn từng bước |
| `pocketful/spec/stage-1.md` … `stage-4.md` | Spec đầy đủ từng stage (cả 4 stage đã công bố lúc kickoff) |
| `pocketful/test/` | **Một phần** test của mỗi stage (phần còn lại giữ kín để chấm) |
| `toy/` | Track luyện tập không tính điểm (bộ đếm dùng chung): đủ toàn bộ test + 3 mandate mẫu (coordinator, implementer, reviewer) |
| `scaffold/` | Service Python tối giản, chỉ dùng cho bài toy |
| `harness/` | CLI `python -m harness`: build các thư mục stage, chạy test, kiểm tra bài nộp offline |

Kết quả nộp là một repo **riêng** do band xây, không đưa gì vào repo kickoff.

### 3.1 Tổng quan các stage (chung cho cả hai track)
| Stage | Xây gì | Chấm bằng |
|---|---|---|
| 1 | JSON API: ghi idempotent, thao tác nhiều mục nguyên tử, export/import trạng thái | Kiểm tra API |
| 2 | Giao diện web, mô hình dữ liệu phong phú hơn, phục hồi khi dữ liệu cũ hoặc mất response | API + Playwright, cộng stage 1 |
| 3 | Trạng thái theo thời gian: điều chỉnh có hiệu lực tại một thời điểm, lịch sử vẫn đúng | API, nâng cấp, ghi đồng thời, cộng stage 1–2 |
| 4 | Thay đổi nguyên tử nhiều bản ghi cùng lúc mà không phá lịch sử | Bộ test riêng + nâng cấp khi đã có dữ liệu, cộng stage 1–3 |

### 3.2 Tỷ lệ test được công bố (pocketful) — phần còn lại bị ẩn
| Stage | 1 | 2 | 3 | 4 |
|---|---|---|---|---|
| Đã công bố | 79% | 35% | 9% | 16% |

---

## 4. Tóm tắt spec pocketful

> Đây là bản tóm tắt để lập kế hoạch. Khi chạy, phải dán toàn văn spec của từng stage vào room; bản tóm tắt này không thay thế được spec.

### 4.1 Ràng buộc chung (mọi stage)
- Giao nộp: HTTP service + `Dockerfile` + `RUN.md` trong mỗi thư mục stage. **Ngôn ngữ, framework, storage tùy ý.** Giám khảo chỉ giao tiếp với container qua HTTP.
- Lắng nghe `0.0.0.0:$PORT` (mặc định 8080). Một container duy nhất; Compose bị bỏ qua.
- Giới hạn: **2 vCPU, 2 GiB RAM, healthy trong 60 s, tối đa 50 request đồng thời, 5 s mỗi request (10 s cho reset), không có mạng ra ngoài khi chạy** (được dùng mạng lúc `docker build`), ổ đĩa tạm.
- Mọi tài nguyên runtime (font, JS, CSS) phải nằm trong image.
- Không bao giờ trả 5xx, kể cả khi tải đồng thời.
- JSON toàn bộ; timestamp RFC 3339 có offset; field/query lạ bị bỏ qua; ID là chuỗi mờ, ≤64 ký tự.
- Mật khẩu phải hash (bcrypt/scrypt/Argon2). Bearer token không hết hạn; cho phép nhiều phiên.
- Body lỗi: `{"error": {"code": "...", "message": "..."}}` với status và code theo spec.

### 4.2 Stage 1 — thanh toán và settlement (chỉ API)
**Bất biến cốt lõi:** (1) tổng số dư luôn bằng tổng được seed ở lần reset gần nhất; (2) không số dư nào âm, kể cả tạm thời; (3) một request chỉ chuyển tiền tối đa một lần.
- Mỗi service một loại tiền, khai báo trong fixture; `minor_units` là 0, 2 hoặc 3 (JPY, EUR, BHD). Mọi số tiền là số nguyên chính xác theo đơn vị nhỏ nhất; tối đa 1.000.000.000 mỗi request. `1000`, `1000.0`, `1e3` là như nhau; chuỗi/boolean không hợp lệ.
- Không có nạp/rút tiền: tiền chỉ chuyển giữa các ví đã có.
- Endpoint test (không cần auth): `GET /health`, `POST /_test/reset` (thay toàn bộ state bằng fixture → 204), `GET /_test/export`, `POST /_test/import` (thay thế nguyên tử; phải giữ token, hash mật khẩu, bản ghi idempotency, response gốc; không sinh lại ID/timestamp).
- Auth: `POST /auth/signup`, `POST /auth/login`. Signup suy ra handle từ phần trước @ của email (viết thường, ký tự ngoài `[a-z0-9_]` → `_`, tối đa 20 ký tự); trùng → `409 handle_taken`.
- API: `GET /me`, `POST /payments`, `POST /requests`, `POST /requests/{id}/pay|decline|cancel`, `GET /requests`, `POST /splits`, `GET /activity`, `POST /settlements` (chỉ operator).
- Trạng thái request: `pending` → đúng một trong `paid` / `declined` / `cancelled`. Request được phép vượt số dư người trả (vẫn pending; trả khi thiếu tiền → 409).
- Quy tắc feed: payment hiển thị khi là `public` HOẶC người gọi là một bên. Request không bao giờ xuất hiện trong feed.
- **Idempotency** (5 đường ghi: payments, requests, pay, splits, settlements): header `Idempotency-Key`, phạm vi theo từng user; cùng method + path + body JSON → 200 với đúng body gốc; khác body → 409; key dùng lại sau lỗi 4xx được coi là lần đầu; request trùng gửi đồng thời → đúng một 201, chỉ có hiệu lực một lần. Key đã dùng được xử lý trước bước validate field.
- **Làm tròn khi chia:** mỗi phần là số nguyên đơn vị nhỏ nhất, tổng đúng bằng amount, chênh nhau ≤1; đơn vị dư dành cho người đứng đầu danh sách (1000/3 → 334, 333, 333; 1/3 → 1, 0, 0). Mỗi người tham gia (trừ người gọi) có một request; phần bằng 0 vẫn tạo request.
- **Settlement:** operator (trong `settlement_operator_ids` của fixture) gửi 1–32 lệnh chuyển; khả năng chi trả xét theo kết quả **ròng** của từng ví; tất cả hoặc không gì cả; các thành viên dùng chung `committed_at`.

### 4.3 Stage 2 — giao diện ví và authorization thanh toán
- Route: `/`, `/requests`, `/split`, `/signup`, `/login`, `/authorizations`. Cùng một path trả HTML khi `Accept: text/html`, ngược lại trả JSON.
- Nhiều thuộc tính `data-testid` bắt buộc (liệt kê trong spec). Số tiền hiển thị dạng `100.00 EUR` / `1200 JPY`; ô nhập nhận số thập phân và từ chối quá số chữ số lẻ (ví dụ `15.005`) mà không gửi request.
- Chất lượng sản phẩm: giao diện tài chính tiêu dùng điềm tĩnh, đáng tin; hệ thống visual nhất quán; dùng tốt ở 375 px và desktop, không cuộn ngang; có label, focus, độ tương phản; trạng thái rỗng/đang tải/lỗi.
- Khả năng chống lỗi: gửi lại form không đổi không được trả tiền hai lần; lần refresh mới nhất thắng dù response về sai thứ tự; mất response thì hiện trạng thái "không chắc chắn" và retry bằng cùng key và body; thao tác bị từ chối phải làm mới dữ liệu cũ.
- Nâng cấp: service stage 2 phải import được bản export của stage 1; trình duyệt đang đăng nhập vẫn giữ phiên; retry đang chờ vẫn hợp lệ.
- **Authorization (giữ tiền):** giữ tiền bây giờ, capture sau (toàn bộ, một phần, hoặc nhiều lần capture không cuối). `available = total − held` không bao giờ âm; `balance == total`; kiểm tra thiếu tiền giờ dựa trên `available`. Hold hết hạn tại `expires_at` (phải phản ánh đúng dù không có request nào đúng lúc đó). Đường ghi mới: authorization, capture (tổng 7 đường idempotent). Chỉ người trả được void; chỉ người nhận được capture.
- Thao tác đồng thời phải tuần tự hóa được (tương đương chạy lần lượt theo một thứ tự nào đó).

### 4.4 Stage 3 — sao kê và điều chỉnh thanh toán
- `GET /me?as_of=<thời điểm>`: số dư trong quá khứ (tính cả thời điểm đó).
- `GET /statement?from&to&limit&offset`: cửa sổ nửa mở, cũ nhất trước, mỗi dòng có `delta` và `balance_after`; số dư đầu + các delta = số dư cuối bất kể phân trang; response đầu tiên trả token `snapshot` để phân trang ổn định kể cả khi có ghi mới sau đó.
- **Lịch sử hai trục thời gian:** mỗi payment có các revision bất biến với `effective_at` (khi tiền có hiệu lực) và `recorded_at` (khi service biết điều đó). Query `known_at` chọn revision mới nhất được ghi tại hoặc trước thời điểm đó.
- Người gửi gốc điều chỉnh payment với `expected_revision` (khóa lạc quan → `409 stale_revision`); phần chênh lệch chuyển giữa đúng hai ví đó; bị từ chối nếu hiện tại không đủ tiền hoặc nếu số dư trong quá khứ bị âm tại bất kỳ mốc hiệu lực nào.
- Thành viên settlement và capture không được điều chỉnh riêng lẻ. Hold trong quá khứ phải tái dựng được trong view `as_of`/`known_at`.
- Phải import được export của stage 1 và 2.

### 4.5 Stage 4 — hoàn tiền và điều chỉnh hàng loạt
- Người nhận gốc hoàn tiền từ số dư **available**; tổng hoàn ≤ số tiền hiện tại sau điều chỉnh; không hoàn một khoản hoàn; hoàn tiền không mở lại request hay hold.
- Operator điều chỉnh hàng loạt: 1–32 payment khác nhau, nguyên tử; điều chỉnh bất kỳ thành viên settlement nào thì phải gồm **mọi** thành viên với cùng thời điểm hiệu lực; thứ tự ưu tiên lỗi được quy định; mọi revision dùng chung một `recorded_at`.
- Tổng 10 đường ghi idempotent. Snapshot cũ vẫn phân trang dữ liệu đã đóng băng. Phải import được export của stage 1–3.

---

## 5. Giải thưởng

Track pocketful: 🥇 $1.500 · 🥈 $1.000 · 🥉 $500 (track kia có mức giải giống hệt).

- Giải chỉ được trao khi track có đủ số bài hợp lệ: ≥1 cho giải nhất, ≥4 cho giải nhì, ≥6 cho giải ba. Giải không trao sẽ không được chia lại.
- Giải Featherless: $300 credit cho đội thắng đầu tiên (track sẽ công bố sau).
- Bài thắng có thể được đăng thành case study, gồm: task, band, quyết định thiết kế chính, kết quả đã kiểm chứng, chi phí, hạn chế.
- Giải có thể mất tới 90 ngày để chi trả. Bài nộp phải là sản phẩm gốc và tuân thủ MIT.

---

## 6. Luật, gate và cách chấm (theo participant guide)

### 6.1 Ba luật quyết định phần lớn bài thi
1. **Code tự tay viết không được tính.** Một stage chỉ được tính khi code qua test là sản phẩm cộng tác của band trong room. Log của room là bằng chứng.
2. **Code viết theo test sẽ bị loại** (kiểm tra sau khi đóng cổng). Test được công bố chỉ để kết nối service; phải xây theo spec. Chạy xanh trên test công bố không chứng minh đã xong stage — hãy hỏi "test công bố chưa hề kiểm tra điều gì?"
3. **Mandate phải chung chung.** Không có đường dẫn endpoint, tên field, mã lỗi hay test id. `harness check` quét `mandates/` theo danh sách từ vựng của track sinh ra từ spec (các token dạng định danh như `/path`, `snake_case`, `kebab-case`). Từ thông thường (amount, balance, handle, status) thì được phép. Danh sách của pocketful có 146 token, gồm cả những từ dễ sót như `not_found`, `validation_failed`, `payment_id`, `minor_units`, `expires_at`, `/payments`, `/split`, `data-status` — danh sách đầy đủ ở §G của file nguồn chính thức. Cách an toàn nhất: mandate không chứa bất kỳ `/đường-dẫn`, `snake_case` hay `kebab-case` nào.

### 6.2 Bốn gate — trượt một gate là bài không được xếp hạng
1. ≥3 seat Band Desktop riêng biệt do bạn cấu hình, mỗi seat có file mandate đặt theo tên seat và ghi rõ harness, model.
2. Log room có tin nhắn **giữa ít nhất hai seat của bạn**, gọi nhau bằng `@handle`, có phản hồi theo cả hai chiều.
3. `stage-1/` build và chạy được từ container sạch theo `RUN.md`.
4. Mandate chung chung, và code được viết theo spec chứ không theo test.

### 6.3 Rubric
| Trọng số | Tiêu chí | Giám khảo xem gì |
|---|---|---|
| **50%** | **Factory** | Mandate **chung chung**; **hiệu quả** (đi được bao xa trong 4 stage, kể cả những gì test công bố không hỏi); **tái sử dụng được** — `FACTORY.md` + `mandates/` đủ để dựng lại, giải thích lựa chọn thiết kế, thời gian và chi phí model đo được, cách phát hiện và phục hồi khi làm sai |
| **25%** | **App** | UI mạch lạc, đủ để trình bày, responsive, rõ ràng ở các trạng thái spec stage 2 nêu, trên nền code dễ bảo trì |
| **25%** | **Agent Teamwork** | **Cộng tác:** nhiều seat cùng làm, review có tạo ra thay đổi, bàn giao mang đủ task, code truy được về room. **Tự chủ:** trong lượt chạy nộp bài, task của mỗi stage là input duy nhất của con người — không điều hướng, phê duyệt, gợi ý debug hay chạy lại |

Không chấm: số lượng tin nhắn, số seat, độ dài prompt. Một seat làm 90% công việc thì vẫn bị đánh giá thấp dù gửi bao nhiêu tin nhắn. Xung đột giả tạo không có giá trị; công việc đúng được chấp nhận ngay lần đầu cũng không bị trừ điểm.

### 6.4 Chuỗi stage
- Mỗi `stage-N/` là service hoàn chỉnh chứa lời giải cho **đúng** stage đó. `stage-2/` = `stage-1/` sao chép rồi mở rộng, tương tự cho các stage sau. Xóa thư mục `.git` trong thư mục đã sao chép.
- Mỗi thư mục được chấm với mọi bộ test từ 1 đến N; chỉ được tính khi qua **≥50% từng** bộ.
- **Luật vượt mức:** thư mục nào qua toàn bộ test của stage kế tiếp thì không được tính.
- **Điểm tính theo chuỗi:** một thư mục chỉ được tính khi mọi thư mục trước đó đều được tính.
- Chỉ nộp các stage đã xong. `stage-1/` là bắt buộc (gate 3).

### 6.5 Lượt chạy nộp bài ("dark-factory run")
- Trong lúc phát triển, cứ thử nghiệm thoải mái (được can thiệp). Sau đó chạy factory đã chọn trong **room mới và repo kết quả mới** — chỉ lượt này được chấm teamwork.
- Từ lúc giao task đến báo cáo cuối của coordinator: không seat nào được hỏi con người hay chờ phản hồi. Vướng mắc được ghi lại làm kết quả của stage.
- Có thể giao từng stage hoặc cả 4 cùng lúc, nhưng **không gửi gì** giữa các lần giao ("ổn rồi, tiếp đi" = điều hướng; giao lại cùng stage = chạy lại).
- Bàn giao phải dán **đầy đủ** task và spec; "đọc room đi" hay một message id không phải là bàn giao. Coordinator phải thêm mọi seat vào room trước lần bàn giao đầu tiên.
- Implementer đăng đầy đủ revision đã commit; reviewer tự chạy kiểm tra độc lập.
- Giữ nguyên lịch sử Git do các seat tạo — không amend/rebase/squash; không tự commit vào `stage-N/`.

---

## 7. Nộp bài

### 7.1 Cấu trúc repo kết quả
```text
your-repo/
  README.md      đội, track, cách đọc repo (bạn tự viết)
  FACTORY.md     seat, lựa chọn thiết kế, cái đã thất bại, chi phí/thời gian đo được, cách xử lý lỗi
  mandates/      mỗi seat một file .md, đặt theo tên seat (ví dụ reviewer.md),
                 các dòng đầu:  Harness: Claude Code
                                Model: <model id chính xác>
  room.json      bản tải đầy đủ của room, không chỉnh sửa
  stage-1/ … stage-4/   mỗi thư mục: Dockerfile, RUN.md, source
```
- Tên file mandate phải khớp tên hiển thị của seat trong room sau khi viết thường và bỏ ký tự không phải chữ/số ("Delivery Manager" → `delivery-manager.md`). Mọi agent có phát biểu trong room đều cần mandate.
- `room.json` phải là bản tải **đầy đủ**, có ≥3 agent gửi tin; gate 2 chỉ tính tin nhắn văn bản thật mà các seat `@mention` nhau theo cả hai chiều (mention nằm trong output của tool không được tính).
- Không dùng submodule hay symlink. Repo GitHub công khai, clone được mà không cần là thành viên Band.
- Nộp trên lablab: URL repo + slide + video. **Video phải cho thấy factory đang chạy**: room, một lần bàn giao giữa các seat và kết quả.

### 7.2 Ghi lại room
Band Desktop → `⋮` của room → **Open in Band** → `⋮` của room trên console → **Download → Download full session** (không chọn "filtered") → lưu nguyên vẹn thành `room.json`. File **không bị che dữ liệu nhạy cảm**: phải kiểm tra secret; nếu lộ thì đổi key và thay giá trị bằng `[REDACTED]`.

### 7.3 Lệnh harness
```sh
# cài đặt (Python 3.12+, Docker đang chạy; trên Windows dùng WSL2)
python3 -m venv .venv && . .venv/bin/activate
python -m pip install -r harness/requirements.txt
python -m playwright install chromium

# kiểm tra một stage (chạy cả các bộ test trước + bộ test kế tiếp để dò vượt mức)
python -m harness run --track pocketful --repo <abs>/band-work/result --stage 1 --out <abs>/band-work/checks/s1-01

# kiểm tra cuối: chế độ isolated = không mạng, 2 vCPU, 2 GiB (giống lúc chấm)
python -m harness run --track pocketful --repo <repo> --stage N --mode isolated --out <thư-mục-mới>
python -m harness run --track pocketful --repo <repo> --all --mode isolated

# kiểm tra bài nộp offline (gate 1, 2, từ vựng mandate, secret, cấu trúc)
python -m harness check <repo> --track pocketful
```
Dòng cần thấy: `claimed stage: N on the shipped checks`. Mỗi lần chạy cần một thư mục `--out` mới.

### 7.4 Checklist trước khi nộp
1. Clone mới → `harness check`. 2. `harness run --all --mode isolated` trên bản clone. 3. Làm theo từng `RUN.md` bằng tay và dùng thử UI. 4. Xác nhận có trao đổi `@handle` hai chiều trong `room.json` và lịch sử Git không bị sửa. 5. `README.md`/`FACTORY.md` có nội dung thật. 6. Đọc lại mandate xem có từ riêng của track không. 7. Quét secret. 8. Nộp bài và giữ biên nhận.

### 7.5 Runtime tùy chọn
- **Seat trong Docker Sandbox** (cần Band Desktop ≥0.4.10, sbx ≥0.42; macOS 14+ Apple silicon, Windows 11, hoặc Ubuntu 24.04+ có KVM): Settings → Experiments → Docker Sandboxes; tạo seat qua **New local agent**, working dir = đường dẫn tuyệt đối tới repo kết quả.
- **Seat OpenCode + Featherless:** config đặt ở `~/.config/opencode/opencode.json` (không bao giờ đặt trong repo), model ví dụ `MiniMaxAI/MiniMax-M2.5`, `moonshotai/Kimi-K2.5`, `deepseek-ai/DeepSeek-V3.2`; chạy `OpencodeAdapter` với `approval_mode="auto_accept"`, `turn_timeout_s=900`. Loại seat này không chạy được trong sandbox.

### 7.6 Luyện trên toy trước
Chạy trọn vòng trên `toy/` (bộ đếm dùng chung, có đủ toàn bộ test), kể cả `room.json` + `harness check` — để tập dượt gate 1 và 2. Mandate mẫu trong `toy/mandates/` là template tối giản (dòng `Harness:`/`Model:` để trống và có quy tắc "không bao giờ hỏi con người").

### 7.7 Hỗ trợ
Discord BAND cho Band Desktop, seat, harness và **chỗ mơ hồ trong spec** (câu trả lời được chia sẻ công khai). Discord lablab cho đăng ký, upload, giải thưởng.

---

## 8. Nền tảng BAND — kiến thức cốt lõi

### 8.1 BAND là gì
BAND là lớp tương tác cho AI agent. Agent xây bằng framework bất kỳ có thể vào chung **chat room**, điều phối việc bằng `@mention`, bàn giao, ủy thác và mời agent khác vào. Con người cũng ngồi trong cùng room. Agent chạy trên hạ tầng **của bạn** với API key LLM **của bạn**; BAND chỉ truyền tin nhắn và ngữ cảnh.

### 8.2 Các khái niệm cơ bản
| Khái niệm | Ý nghĩa |
|---|---|
| Agent | Định nghĩa (tên, mô tả, model, tool) do bạn tự chạy; dùng lại được ở nhiều room |
| Chat room | Không gian chung chứa tin nhắn/sự kiện; là đơn vị điều phối; ngữ cảnh giới hạn trong room |
| `@mention` | Cơ chế định tuyến. **Agent chỉ thấy tin nhắn có mention nó.** Con người thấy tất cả |
| Contact | Kết nối có kiểm soát quyền giữa agent/người dùng khác tài khoản |
| Execution | Một phiên chạy độc lập của một agent trong một room |
| Peer và participant | Peer = có thể mời; participant = đang ở trong room |

### 8.3 Tool nền tảng (adapter tự cung cấp cho LLM)
`band_send_message`, `band_send_event`, `band_add_participant`, `band_remove_participant`, `band_get_participants`, `band_lookup_peers`, `band_create_chatroom`. Tool contact phải bật thủ công (`capabilities={Capability.CONTACTS}`), chỉ cần khi làm việc giữa các tài khoản khác nhau.

### 8.4 Gói miễn phí
Không cần thẻ. Tối đa **10 agent**, đầy đủ Agent API + WebSocket, mọi tool `band_*`, room nhiều agent. Memory API và Human API chỉ có ở gói Enterprise.

### 8.5 SDK
- Python: `pip install "band-sdk[<extra>]"`, import bằng `band`. TypeScript: `@band-ai/sdk` (Python ổn định hơn).
- Extra: `langgraph`, `anthropic`, `crewai`, `pydantic-ai`, `claude_sdk`, `agno`, … (kết hợp được).
- Mẫu chung: tạo adapter → `Agent.create(adapter, agent_id, api_key)` → `await agent.run()`.
- Credential: mỗi agent một block trong `agent_config.yaml`; key LLM để trong `.env`. Đưa cả hai vào `.gitignore`.
- **Adapter cho coding agent:** `ClaudeSDKAdapter` (Claude Code), `CodexAdapter` (Codex CLI), `OpencodeAdapter`, `CopilotSDKAdapter` / `CopilotACPAdapter`.
- Nạp mandate vào `custom_section` của adapter (ví dụ `Path("prompts/planner.md").read_text()`), đặt `cwd` trỏ tới repo.

### 8.6 Lỗi hay gặp
- **Mỗi `agent_id` chỉ có một WebSocket đang chạy.** Mỗi seat cần đăng ký, UUID và API key riêng.
- Không đặt tên agent là "Assistant", "AI", "Bot", "Agent" vì LLM hiểu nhầm thành vai trò.
- Bật event khi quay video (không truyền `emit=()`): tool call và kết quả hiện trong room làm bằng chứng. `Emit.THOUGHTS` hỗ trợ trên Agno, Claude SDK, Codex, Copilot SDK.
- Agent khởi động lại sẽ khôi phục lịch sử qua endpoint `/context`.

---

## 9. BAND Desktop (trước đây là Jam)

- App desktop (macOS / Windows / Linux), là nơi điều phối và giám sát: agent đang kết nối, room, work item, người phụ trách, swim lane, hoạt động, mức sử dụng, các yêu cầu cần quyết định.
- **App không chạy model.** Coding agent chạy dạng tiến trình headless trong môi trường của bạn.
- Thành phần: app Desktop · CLI `band` · daemon `jamd` (lưu trạng thái ở `~/.jam`) · plugin `band-peer` cho Claude Code.
- Yêu cầu: tài khoản BAND và **Claude Code đã cài và đăng nhập** (cách mặc định).
- Quy trình cài: cài app → *Sign in with browser* → readiness check (CLI có trong PATH, đã có plugin `band-peer`) → khởi động lại Claude Code hoặc chạy `/reload-plugins` → bấm **Recheck**.
- Agent đầu tiên: trong Claude Code gõ `/jam`, rồi ví dụ "Start a Band Desktop session as the architect for this project." Architect sẽ tạo room và mời các agent khác.
- Thêm vai trò: mỗi vai trò (developer, tester, reviewer…) một cửa sổ Claude Code, yêu cầu từng cửa sổ tham gia cùng collaboration.
- Gắn lại sau khi khởi động lại: "Reattach this session to the existing architect peer."
- Linux + Wayland + NVIDIA: chạy `WEBKIT_DISABLE_DMABUF_RENDERER=1 band-desktop`, hoặc chuyển sang X11.

---

## 10. Các pattern cộng tác (theo hacker guide của BAND)

| Pattern | Dùng khi | Cách làm trên BAND |
|---|---|---|
| Dây chuyền (assembly line) | Việc có các bước rõ ràng, bước sau dựa trên bước trước | Agent `@mention` agent kế tiếp khi xong |
| Hội đồng (panel) | Bất đồng chính là giá trị | Mention tất cả chuyên gia; người tổng hợp nói sau cùng |
| Fan-out / fan-in | Nhiều kiểm tra độc lập → một kết luận | Coordinator mention N agent kiểm tra cùng lúc |
| Tuyển người lúc chạy | Chuyên gia cần dùng tùy từng trường hợp | `band_lookup_peers` → `band_add_participant` |
| Phòng phụ (breakout room) | Việc phụ ồn ào làm loãng luồng chính | `band_create_chatroom`, báo tóm tắt về room chính |
| **Agent phản biện (critic overlay)** | Kết quả phải chịu được soi xét | Thêm agent có **quyền phủ quyết thật** ("trả lời BLOCKED và nêu bằng chứng còn thiếu"); coordinator coi BLOCKED là điểm dừng |
| Một cổng con người | Quyết định có hậu quả | Một agent duy nhất phụ trách leo thang (lưu ý: cuộc thi chấm **tự chủ**, không có input của con người ngoài task mỗi stage) |
| Máy trạng thái chung | Việc kéo dài | Thông báo thay đổi trạng thái; agent kiểm tra trạng thái trước khi làm |

**Dấu hiệu dùng BAND "có ý nghĩa":** bàn giao phụ thuộc (agent sau phản hồi phát hiện của agent trước, không chỉ làm lại task) · đội hình quyết định lúc chạy · ranh giới do BAND bảo đảm · kết luận có thể bị chặn.
**Phản mẫu:** spam cập nhật trạng thái · một tiến trình đổi vai liên tục · orchestrator tự viết gọi agent lần lượt · chỉ có dashboard làm sản phẩm.

**Phần giải thích nên có (phù hợp đưa vào `FACTORY.md`):** đội hình (agent, framework/model, mỗi agent một việc) · ai nói với ai và ai được cố ý loại khỏi mention · một luồng end-to-end viết trên một dòng · "bỏ room đi thì cái gì hỏng".

Mẫu mandate (dạng chung chung, được phép):
```
You are the planner for this repository.
Own: inspect the request and repository, write an ordered plan with one owner
and acceptance criteria per task.
Do not: edit files or claim tests passed unless you ran them.
Use: existing project structure and conventions; name validation commands.
Ask a person: when requirements conflict or a product decision is needed.
Done means: plan posted in the room, tasks assigned, open questions called out.
```
⚠️ Ở cuộc thi này, dòng "Ask a person" mâu thuẫn với điểm tự chủ: lượt chạy nộp bài không được cần input của con người sau khi đã giao task cho stage.

---

## 11. Tài nguyên từ đối tác

- **Featherless AI:** API serverless tương thích OpenAI, hơn 30.000 model mở (DeepSeek, Llama, Qwen, Mistral, Kimi). Mỗi người được $25 credit tính theo request, context tối đa 256K, dành cho 1.000 người đăng ký đầu tiên; mã khuyến mãi được gửi qua email trước kickoff. Đăng ký cần thẻ, nên hủy trước kỳ thanh toán tiếp theo nếu không dùng tiếp.
- **Docker Sandboxes:** môi trường cô lập, tái lập được; hữu ích để test yêu cầu "container sạch, không mạng ra ngoài". Docs: https://docs.docker.com/ai/sandboxes/ · Kit cho BAND: https://docs.band.ai/integrations/sandboxes/docker-sbx-kit

---

## 12. Link

| Tài nguyên | URL |
|---|---|
| Trang cuộc thi | https://lablab.ai/ai-hackathons/wearedevelopers-hackathon |
| Repo starter | https://github.com/band-ai/dark-factory-wearedevs |
| Tài khoản BAND | https://app.band.ai/ |
| Docs BAND Desktop | https://docs.band.ai/band-desktop |
| Hacker guide | https://www.band.ai/hacker-guide |
| Cài coding agent | https://docs.band.ai/integrations/sdks/tutorials/coding-agents |
| Tổng quan SDK | https://docs.band.ai/integrations/sdks/overview |
| API reference | https://docs.band.ai/api/introduction |
| Mục lục docs cho agent | https://docs.band.ai/llms.txt |
| Luật lablab | https://lablab.ai/hackathon-rules |
| Discord BAND | https://discord.com/invite/5YkNXmYfjk |
| Discord lablab | https://discord.gg/lablabai |

---

## 13. Câu hỏi mở cho agent lập kế hoạch

0. Trước khi lập kế hoạch, xác nhận repo không đổi sau commit `803560d`: chạy `git pull` trong bản clone kickoff và xem Discord BAND có làm rõ spec công khai nào không.
1. Đội hình seat (≥3, mỗi seat một danh tính Band riêng) và harness/model cho từng seat; cách chia việc để không seat nào gánh ~90%.
2. Factory phát hiện sai sót thế nào khi không có con người: reviewer tự chạy `harness run`, cộng test riêng suy ra từ **spec** (không phải từ test công bố) — đặc biệt cho phần test ẩn (stage 2: 65%, stage 3: 91%, stage 4: 84% bị ẩn).
3. Chọn stack cho service (ngôn ngữ tùy ý) phù hợp 2 vCPU / 2 GiB, concurrency tuần tự hóa được và lịch sử hai trục thời gian ở stage 3–4 (ví dụ SQL nhúng có transaction).
4. Cách đo và báo cáo thời gian, chi phí model cho từng stage trong `FACTORY.md`.
5. Ngân sách thời gian: tính từ 02/10, còn khoảng 3,5 ngày (hạn 13:59 ngày 6/10 giờ Việt Nam). Kế hoạch: tập dượt toy → phát triển factory trên stage 1 → lượt chạy nộp bài mới hoàn toàn → ghi room, viết tài liệu, quay video.
6. Máy làm việc: harness cần Docker + Python 3.12+; trên Windows phải chạy trong WSL2.
