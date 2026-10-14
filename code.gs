/**
 * SBO 상담일지 DB 자동 연동 (저장 / 수정 / 삭제 지원) & AI 일정/병원 분석 웹앱 (Google Apps Script)
 * 스프레드시트: SBO-상담일지 (ID: 1m__S_nHq5Q_5pN6b20IWjrIqbHzBc1GzDTfaCWfL22M)
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = {};
    
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch(err) {
        data = e.parameter;
      }
    } else if (e.parameter) {
      data = e.parameter;
    }
    
    var action = data.action || "create"; // "create", "update", "delete"
    var logId = data.logId || "";
    var callDate = data.callDate || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var origCallDate = data.origCallDate || callDate;
    var name = data.name || "";
    var card = data.card || "";
    var phone = data.phone || "";
    var memo = data.memo || "";
    var origMemo = data.origMemo || "";
    
    var aiAnalysis = analyzeMemoAI(memo);
    var appointment = data.appointment || aiAnalysis.appointment || "없음";
    var hospital = data.hospital || aiAnalysis.hospital || "없음";

    // 수정(update) 또는 삭제(delete)일 경우 기존 행 탐색
    if (action === "update" || action === "delete") {
      var values = sheet.getDataRange().getValues();
      var targetRow = -1;
      var cleanTargetPhone = String(phone).replace(/[^0-9]/g, "");
      
      // 아래에서 위로 검색 (최근 기록 우선 매칭)
      for (var i = values.length - 1; i >= 1; i--) {
        var rDate = String(values[i][0]).trim();
        var rName = String(values[i][1]).trim();
        var rPhone = String(values[i][3]).replace(/[^0-9]/g, "");
        var rMemo = String(values[i][4]).trim();
        
        var phoneMatch = (cleanTargetPhone && rPhone === cleanTargetPhone) || (rName === name);
        var dateOrMemoMatch = (rDate === origCallDate) || (origMemo && rMemo === origMemo);
        
        if (phoneMatch && dateOrMemoMatch) {
          targetRow = i + 1; // 1-based row index
          break;
        }
      }
      
      if (targetRow !== -1) {
        if (action === "delete") {
          sheet.deleteRow(targetRow);
          return ContentService.createTextOutput(JSON.stringify({
            status: "success",
            action: "delete",
            message: "상담일지가 삭제되었습니다."
          })).setMimeType(ContentService.MimeType.JSON);
        } else if (action === "update") {
          sheet.getRange(targetRow, 1, 1, 7).setValues([[
            callDate,
            name,
            card,
            phone,
            memo,
            appointment,
            hospital
          ]]);
          return ContentService.createTextOutput(JSON.stringify({
            status: "success",
            action: "update",
            message: "상담일지가 수정되었습니다."
          })).setMimeType(ContentService.MimeType.JSON);
        }
      } else if (action === "delete") {
        return ContentService.createTextOutput(JSON.stringify({
          status: "not_found",
          action: "delete",
          message: "시트에서 삭제할 대상 행을 찾지 못했습니다."
        })).setMimeType(ContentService.MimeType.JSON);
      }
      // 만약 update인데 기존 행을 못 찾았으면 새로 추가(fallback)
    }
    
    // 신규 저장 (create)
    // [A] 전화상담일, [B] 성명, [C] 카드번호, [D] 전화번호, [E] 상담내용, [F] (AI) 약속일시, [G] (AI) 진료병원
    sheet.appendRow([
      callDate,
      name,
      card,
      phone,
      memo,
      appointment,
      hospital
    ]);
    
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      action: "create",
      message: "상담일지가 성공적으로 저장되었습니다.",
      savedData: {
        logId: logId,
        callDate: callDate,
        name: name,
        card: card,
        phone: phone,
        memo: memo,
        appointment: appointment,
        hospital: hospital
      }
    })).setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = sheet.getDataRange().getValues();
    var rows = [];
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[0] || row[1] || row[3]) {
        rows.push({
          callDate: String(row[0]),
          name: String(row[1]),
          card: String(row[2]),
          phone: String(row[3]),
          memo: String(row[4]),
          appointment: String(row[5]),
          hospital: String(row[6])
        });
      }
    }
    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      count: rows.length,
      logs: rows
    })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function analyzeMemoAI(text) {
  if (!text) return { appointment: "없음", hospital: "없음" };
  var t = text.trim();
  
  var hospital = "없음";
  var hospRegexes = [
    /(화이트\s*e\s*치과(?:\s*\(?[서덕해][가-힣]*점\)?)?)/i,
    /(화이트\s*이\s*치과(?:\s*\(?[서덕해][가-힣]*점\)?)?)/i,
    /(친절한\s*참치과(?:\s*의원)?)/,
    /(참치과(?:\s*의원)?)/,
    /(백록\s*안과)/,
    /(밝은\s*성모\s*안과)/,
    /(밝은\s*눈\s*안과)/,
    /(수정\s*안과)/,
    /(연제\s*일신\s*병원)/,
    /(메디\s*우먼)/,
    /([가-힣]{2,10}(?:안과|치과|병원|의원))/,
    /([덕서해][가-힣]*점\s*(?:치과|안과)?)/
  ];
  for (var i = 0; i < hospRegexes.length; i++) {
    var match = t.match(hospRegexes[i]);
    if (match) {
      hospital = match[1].replace(/\s+/g, " ").trim();
      break;
    }
  }
  
  var appointment = "없음";
  var dateRegexes = [
    /(\d{4}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}일?(?:\s*(?:오전|오후)?\s*\d{1,2}(?:시|:\d{2})(?:\s*\d{1,2}분)?)?)/,
    /(\d{1,2}[월/.]\s*\d{1,2}일?(?:\s*(?:오전|오후)?\s*\d{1,2}(?:시|:\d{2})(?:\s*\d{1,2}분)?)?)/,
    /((?:오늘|내일|모레|다음주\s*[월화수목금토일]요일?)\s*(?:오전|오후)?\s*\d{1,2}(?:시|:\d{2})(?:\s*\d{1,2}분)?)/,
    /(\d{1,2}일\s*(?:오전|오후)\s*\d{1,2}시(?:\s*\d{1,2}분)?)/
  ];
  for (var j = 0; j < dateRegexes.length; j++) {
    var dMatch = t.match(dateRegexes[j]);
    if (dMatch) {
      appointment = dMatch[1].trim();
      break;
    }
  }
  
  return { appointment: appointment, hospital: hospital };
}
