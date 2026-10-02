# Pocketful — Stage 4: hoàn tiền và điều chỉnh hàng loạt

> **Bản dịch tham khảo để đọc hiểu.** Bản chuẩn là [stage-4.md](stage-4.md) (tiếng Anh, nguyên văn của ban tổ chức).
> Khi giao việc cho band, luôn dán **bản tiếng Anh**, không dán bản này. Tên endpoint, field, mã lỗi và JSON được giữ nguyên.

Người nhận có thể hoàn tiền (refund) các payment. Settlement operator có thể điều chỉnh nhiều
payment trong một request, kể cả payment thuộc một settlement. Biên nhận đã có và sao kê đã lưu phải
còn truy cập được ở dạng gốc.

Mọi yêu cầu từ stage 1–3 vẫn áp dụng. Có mười đường ghi idempotent: năm đường của stage 1,
authorization và capture từ stage 2, điều chỉnh từ stage 3, và refund cùng correction batch ở stage
này.

## Hoàn tiền và lịch sử đã điều chỉnh

`POST /payments/{payment_id}/refunds`, body `{"amount": 200}`, cần idempotency key. Chỉ người nhận
gốc được hoàn tiền, nếu không thì 403 `forbidden`; payment không tồn tại thì 404. Đối tượng được hoàn
có thể là payment trực tiếp, payment trả request hoặc capture, nhưng không bao giờ là một refund. Số
tiền không hợp lệ là 422 `validation_failed`. Tổng cộng dồn các lần hoàn không được vượt số tiền hiện
tại đã điều chỉnh của payment: 422 `refund_exceeds_payment`. Hoàn tiền cho một refund thì trả
422 `invalid_refund_target`.

Refund là một payment mới theo chiều ngược lại, với `refund_of` chỉ tới payment được hoàn,
`request_id: null`, `authorization_id: null`, cùng note/visibility gốc. Trả 201 với payment đó;
replay trả 200 với body gốc. Nó chuyển tiền đang có từ tiền **khả dụng** (available) của người nhận,
hoặc thất bại với 409 `insufficient_funds`, một cách nguyên tử. Refund không bao giờ mở lại request
hay authorization, cũng không khôi phục hold đã được trả lại. Các payment khác có `refund_of: null`.

Điều chỉnh của stage 3 vẫn dùng được cho payment trực tiếp/payment trả request thông thường. Bản
thân capture và payment refund không điều chỉnh được: 422 `linked_payment_immutable`. Điều chỉnh
không được giảm payment xuống dưới số tiền đã hoàn: 422 `refund_exceeds_payment`. Khoản trừ do điều
chỉnh được kiểm tra theo tiền khả dụng.

## Điều chỉnh hàng loạt

`POST /correction-batches` cần settlement operator và idempotency key, với cùng quy tắc 401/403 như
settlement. Body:

```json
{"corrections": [{"payment_id": "p_a", "expected_revision": 1, "amount": 0,
                  "effective_at": "2026-09-20T12:00:00+00:00", "reason": "reversal"},
                 {"payment_id": "p_b", "expected_revision": 1, "amount": 0,
                  "effective_at": "2026-09-20T12:00:00+00:00", "reason": "reversal"}]}
```

`corrections` chứa 1..32 object với các payment_id khác nhau, nếu không thì 422 `validation_failed`.
Mỗi mục có các field và quy tắc validate của điều chỉnh thông thường. Payment không tồn tại là 404;
expected revision đã cũ là 409 `stale_revision`. Operator được điều chỉnh payment thông thường,
payment trả request và payment thuộc settlement, nhưng capture và refund vẫn bất biến. Điều chỉnh
bất kỳ thành viên nào của settlement thì phải đưa vào mọi thành viên của settlement đó, nếu không thì
422 `incomplete_settlement`. Các thành viên của một settlement phải có cùng thời điểm hiệu lực (cách
viết offset có thể khác nhau), nếu không thì 422 `validation_failed`. Điều chỉnh từng payment riêng
lẻ vẫn dùng được cho payment không thuộc settlement. Field lạ bị bỏ qua.

Thứ tự ưu tiên lỗi là: lỗi của từng mục theo thứ tự đầu vào, tính đầy đủ của settlement, tiền khả
dụng hiện tại sau khi áp dụng, rồi tổng tiền và tiền khả dụng trong quá khứ tại mọi mốc hiệu lực/sự
kiện. Dùng các code hiện có: `linked_payment_immutable`, `refund_exceeds_payment`,
`insufficient_funds`, `historical_overdraft`. Khả năng chi trả được xác định theo tác động gộp của
mọi revision được đề xuất. Lô bị từ chối thì giữ nguyên lịch sử, số dư và bản ghi idempotency.

Trả 201 với `correction_batch_id`, `recorded_at` và `revisions` theo thứ tự đầu vào. Mọi revision mới
dùng chung recorded_at, muộn hơn ngặt so với recorded_at trước đó của mọi thành viên; mỗi revision
cũng có correction_batch_id. Thời điểm hiệu lực không được muộn hơn hiện tại. Payment gốc và biên
nhận không bao giờ thay đổi. Retry payment và settlement gốc trả về body gốc. Sao kê mới phản ánh các
revision mới; token snapshot cũ vẫn phân trang các mục đã đóng băng. Replay trả response gốc của lô
với 200. Mục này thêm một đường ghi idempotent.

Payment thuộc settlement có thể được hoàn tiền theo quy tắc refund hiện có, nhưng refund không bao
giờ thay đổi thành viên của settlement. Các điều chỉnh đồng thời dùng chung bất kỳ revision payment
mong đợi nào không thể cùng thành công. Service stage 4 phải chấp nhận bản export do stage 1–3 của
cùng đội tạo ra, giữ nguyên thành viên settlement, các điều chỉnh và snapshot.
