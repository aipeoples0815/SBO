import json, csv, re, os

def parse_currency(val):
    if not val: return 0
    s = re.sub(r"[^0-9]", "", str(val))
    return int(s) if s else 0

def clean_phone(p):
    return re.sub(r"[^0-9]", "", str(p or ""))

def clean_date(d):
    if not d: return ""
    s = str(d).strip()
    s = s.replace("2026. ", "2026-").replace("2026.", "2026-").replace(". ", "-").replace(".", "-")
    # if 26-04-02 -> 2026-04-02
    parts = s.split("-")
    if len(parts) == 3:
        y, m, day = parts
        if len(y) == 2: y = "20" + y
        if len(m) == 1: m = "0" + m
        if len(day) == 1: day = "0" + day
        return f"{y}-{m}-{day}"
    return s

with open("compact_customers.json", "r", encoding="utf-8") as f:
    customers = json.load(f)

# Build fast indexes
phone_map = {}
card_map = {}

for c in customers:
    p_dig = clean_phone(c.get("p", ""))
    c_dig = clean_phone(c.get("c", ""))
    if p_dig: phone_map[p_dig] = c
    if c_dig: card_map[c_dig] = c

with open("downloads/dental_db.csv", "r", encoding="utf-8") as f:
    dental_rows = list(csv.reader(f))[2:]

matched_count = 0
for r in dental_rows:
    name = r[3].strip()
    card = r[2].strip()
    phone = r[5].strip()
    if not name and not card and not phone: continue
    
    p_dig = clean_phone(phone)
    c_dig = clean_phone(card)
    
    target_cust = None
    if p_dig and p_dig in phone_map:
        target_cust = phone_map[p_dig]
    elif c_dig and c_dig in card_map:
        target_cust = card_map[c_dig]
        
    if not target_cust:
        continue
        
    matched_count += 1
    
    branch = r[9].strip() or "치과"
    book_date = clean_date(r[8])
    first_visit = clean_date(r[6])
    hm_reg_date = clean_date(r[1])
    hm_first_use = clean_date(r[15])
    path = r[12].strip()
    intro = r[10].strip()
    
    pay_hm_first = parse_currency(r[31])
    pay_non_first = parse_currency(r[32])
    pay_hm_total = parse_currency(r[33])
    pay_non_total = parse_currency(r[34])
    grand_total = pay_hm_total + pay_non_total
    
    implant_cnt = r[16].strip()
    implant_amt = parse_currency(r[17])
    denture_part_cnt = r[18].strip()
    denture_part_amt = parse_currency(r[19])
    denture_full_cnt = r[20].strip()
    denture_full_amt = parse_currency(r[21])
    denture_temp_cnt = r[22].strip()
    denture_temp_amt = parse_currency(r[23])
    ortho_other = r[26].strip()
    non_covered_amt = parse_currency(r[27])
    consult_amt = parse_currency(r[28])
    
    treatments = []
    if implant_cnt or implant_amt > 0: treatments.append(f"임플란트({implant_cnt or '보험'})")
    if denture_part_cnt or denture_part_amt > 0: treatments.append(f"부분틀니({denture_part_cnt or '1'})")
    if denture_full_cnt or denture_full_amt > 0: treatments.append(f"완전틀니({denture_full_cnt or '1'})")
    if denture_temp_cnt or denture_temp_amt > 0: treatments.append(f"임시틀니({denture_temp_cnt or '1'})")
    if ortho_other: treatments.append(f"교정/특화({ortho_other})")
    
    treat_str = ", ".join(treatments) if treatments else "일반진료/검진"
    
    # Store structured dental info
    dental_record = {
        "branch": branch,
        "book_date": book_date,
        "first_visit": first_visit,
        "first_use_hm": hm_first_use,
        "treatments": treat_str,
        "pay_hm_total": pay_hm_total,
        "pay_non_total": pay_non_total,
        "grand_total": grand_total,
        "pay_hm_first": pay_hm_first,
        "consult_amt": consult_amt,
        "path": path,
        "intro": intro
    }
    target_cust["dt"] = dental_record
    
    # Add badges
    badges = set(target_cust.get("bg", []))
    badges.add(f"치과:{branch}점")
    if grand_total > 0:
        badges.add(f"치과결제:{grand_total:,}원")
    if implant_amt > 0 or implant_cnt:
        badges.add("임플란트치료")
    if denture_part_amt > 0 or denture_full_amt > 0:
        badges.add("틀니치료")
    if ortho_other:
        badges.add("치아교정")
    target_cust["bg"] = sorted(list(badges))
    
    # Add rich timeline event
    evt_date = first_visit or book_date or hm_reg_date or "2026-04"
    evt_sum = f"치과 내원 및 진료 ({branch}점" + (f" / 총 {grand_total:,}원" if grand_total > 0 else "") + ")"
    detail_parts = [
        f"지점: {branch}점",
        f"예약일: {book_date or '-'}",
        f"최초내원일: {first_visit or '-'}",
        f"진료과목: {treat_str}"
    ]
    if grand_total > 0:
        detail_parts.append(f"결제금액: 한마음 {pay_hm_total:,}원" + (f" + 비급여 {pay_non_total:,}원" if pay_non_total > 0 else ""))
    if path: detail_parts.append(f"경로: {path}")
    if intro: detail_parts.append(f"소개자: {intro}")
    
    evt_det = " | ".join(detail_parts)
    target_cust["ev"].append([
        evt_date, "치과심층", "치과진료/치료", "내원완료" if first_visit else "예약",
        evt_sum, evt_det, "치과전용시트"
    ])
    
    # Re-sort events descending
    target_cust["ev"].sort(key=lambda x: str(x[0] or ""), reverse=True)

print(f"Matched and enriched {matched_count} dental patients in customer database!")

# Re-assign numeric idx
for idx, c in enumerate(customers):
    c["idx"] = idx

with open("compact_customers_v2.json", "w", encoding="utf-8") as f:
    json.dump(customers, f, ensure_ascii=False, separators=(',', ':'))

print("Saved compact_customers_v2.json, size:", os.path.getsize("compact_customers_v2.json") / 1024 / 1024, "MB")
