const { DateTime } = require('luxon');

/**
 * Sinh ra `count` mốc thời gian đăng chương kế tiếp, dựa theo:
 *  - daysOfWeek: mảng số 0-6 (0 = Chủ nhật … 6 = Thứ 7), giống JS Date#getDay()
 *  - timeOfDay:  chuỗi "HH:mm" (giờ địa phương theo `timezone`)
 *  - timezone:   IANA tz string, vd "Asia/Bangkok"
 *  - chaptersPerSlot: số chương đăng cùng lúc mỗi mốc (mặc định 1)
 *  - after:      ISO string hoặc null — chỉ sinh mốc SAU thời điểm này
 *                (mặc định = hiện tại)
 *
 * Trả về mảng ISO string (UTC), độ dài = count.
 */
function computeNextSlots({ daysOfWeek, timeOfDay, timezone, chaptersPerSlot = 1, count, after }) {
  if (!Array.isArray(daysOfWeek) || daysOfWeek.length === 0) {
    throw new Error('daysOfWeek phải có ít nhất 1 ngày.');
  }
  const [hh, mm] = String(timeOfDay || '17:00').split(':').map((n) => parseInt(n, 10));
  const zone = timezone || 'Asia/Bangkok';

  let cursor = after ? DateTime.fromISO(after, { zone }) : DateTime.now().setZone(zone);
  if (!cursor.isValid) cursor = DateTime.now().setZone(zone);

  const slots = [];
  // bắt đầu quét từ đầu ngày hiện tại của cursor để không bỏ sót slot hôm nay
  let day = cursor.startOf('day');
  let guard = 0; // an toàn tránh vòng lặp vô hạn

  while (slots.length < count && guard < 3650) {
    guard++;
    // luxon: weekday 1(Mon)-7(Sun) → đổi sang 0(Sun)-6(Sat) như JS
    const jsDay = day.weekday % 7;
    if (daysOfWeek.includes(jsDay)) {
      const slotTime = day.set({ hour: hh || 0, minute: mm || 0, second: 0, millisecond: 0 });
      if (slotTime > cursor) {
        for (let i = 0; i < chaptersPerSlot && slots.length < count; i++) {
          slots.push(slotTime.toUTC().toISO());
        }
      }
    }
    day = day.plus({ days: 1 });
  }

  return slots;
}

module.exports = { computeNextSlots };
