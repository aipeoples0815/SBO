/**
 * SBO 상담일지 DB 자동 연동 및 AI 일정/병원 분석 웹앱 (Google Apps Script)
 * 스프레드시트: SBO-상담일지 (ID: 1m__S_nHq5Q_5pN6b20IWjrIqbHzBc1GzDTfaCWfL22M)
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = {};
    
    // JSON or form-data parsing
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch(err) {
        data = e.parameter;
      }
    } else if (e.parameter) {
      data = e.parameter;
    }
    
    var callDate = data.callDate || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm");
    var name = data.name || "";
    var card = data.card || "";
    var phone = data.phone || "";
    var memo = data.memo || "";
    
    // AI 일정 및 병원 분석
    var aiAnalysis = analyzeMemoAI(memo);
    var appointment = data.appointment || aiAnalysis.appointment || "없음";
    var hospital = data.hospital || aiAnalysis.hospital || "없음";
    
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
    
    var result = {
      status: "success",
      message: "상담일지가 성공적으로 저장되었습니다.",
      savedData: {
        callDate: callDate,
        name: name,
        card: card,
        phone: phone,
        memo: memo,
        appointment: appointment,
        hospital: hospital
      }
    };
    
    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (error) {
    var errorResult = {
      status: "error",
      message: error.toString()
    };
    return ContentService.createTextOutput(JSON.stringify(errorResult))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  // GET 요청 시 최근 상담일지 50건 반환 (대시보드 실시간 조회용)
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = sheet.getDataRange().getValues();
    var rows = [];
    
    // 헤더 제외하고 데이터 추출
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (row[0] || row[1] || row[3]) {
        rows.push({
          callDate: row[0],
          name: row[1],
          card: row[2],
          phone: row[3],
          memo: row[4],
          appointment: row[5],
          hospital: row[6]
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

/**
 * 상담 메모 내용 기반 AI 일정 및 병원 자연어 분석 엔진
 */
function analyzeMemoAI(text) {
  if (!text) return { appointment: "없음", hospital: "없음" };
  var t = text.trim();
  
  // 1. 진료병원 감지
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
    /([덕서해]\w*점\s*(?:치과|안과)?)/
  ];
  
  for (var i = 0; i < hospRegexes.length; i++) {
    var match = t.match(hospRegexes[i]);
    if (match) {
      hospital = match[1].replace(/\s+/g, " ").trim();
      break;
    }
  }
  
  // 2. 약속일시 감지
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
  
  return {
    appointment: appointment,
    hospital: hospital
  };
}
