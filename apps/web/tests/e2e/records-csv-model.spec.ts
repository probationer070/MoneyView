import { expect, test } from "@playwright/test";
import { csvField, recordRows, recordsCsv, recordsCsvName } from "../../lib/recordsCsv";
import { HISTORY, MOVERS_DAYS, OLD_ALERT_SUMMARY, SURGE_HISTORY } from "./helpers/riskApiMock";

// Plan Task 5: the /alerts CSV is built in the browser from the API's values (risk UI spec §4).
const rows = recordRows(HISTORY, SURGE_HISTORY, MOVERS_DAYS);
const ofKind = (kind: string) => rows.filter((row) => row.kind === kind);
const lines = (csv: string) => csv.split("\r\n");

test("RFC 4180 quoting: comma, quote, CR and LF are quoted, quotes doubled, plain text is not", () => {
  expect(csvField("plain")).toBe("plain");
  expect(csvField("a,b")).toBe("\"a,b\"");
  expect(csvField("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
  expect(csvField("two\nlines")).toBe("\"two\nlines\"");
  expect(csvField("cr\rhere")).toBe("\"cr\rhere\"");
  expect(csvField(null)).toBe("");
  expect(csvField(-7.4123456)).toBe("-7.4123456");
});

test("lines end in CRLF and a field holding a comma stays one field", () => {
  const csv = recordsCsv([rows.find((row) => row.kind === "risk" && row.id === "5")!], "risk", "en");
  expect(csv.endsWith("\r\n")).toBe(true);
  expect(lines(csv)[1]).toContain(",\"AI infrastructure, Semiconductors\",");
});

test("headers follow the UI language", () => {
  expect(lines(recordsCsv([], "risk", "en"))[0]).toBe(
    "ID,Origin,Start date,Release date,Days,Theme count,Themes,Warnings on,Primary theme,5D after,10D after,20D after,Max further drop in 10D,vs −5%",
  );
  expect(lines(recordsCsv([], "risk", "ko"))[0]).toBe(
    "번호,구분,시작일,해제일,일수,테마 수,테마,켜진 지표,주 테마,5일 뒤,10일 뒤,20일 뒤,10일 안 최대 추가 하락,기준 −5%",
  );
  expect(lines(recordsCsv([], "surge", "ko"))[0]).toBe("번호,구분,테마,시작일,끝난 날,끝난 이유,배너 표시,5일 뒤,10일 뒤,20일 뒤,10일 안 최대 추가 상승");
  expect(lines(recordsCsv([], "movers", "en"))[0]).toBe(
    "Date,#1 Ticker,#1 Name,#1 Change,#2 Ticker,#2 Name,#2 Change,#3 Ticker,#3 Name,#3 Change,#4 Ticker,#4 Name,#4 Change,#5 Ticker,#5 Name,#5 Change",
  );
  expect(lines(recordsCsv([], "all", "ko"))[0]).toBe("종류,번호,구분,시작일,끝난 날,대상");
});

test("numbers are the API values, not rounded; text cells follow the language", () => {
  const old = rows.filter((row) => row.kind === "risk" && row.id === String(OLD_ALERT_SUMMARY.id));
  expect(lines(recordsCsv(old, "risk", "ko"))[1]).toBe(
    "5,실시간,2025-06-10,2025-06-30,14,2,\"AI 인프라, 반도체\",W2 W5,AI 인프라,-2.123456789,-7.4123456,1.5,-7.4123456,넘음",
  );
  expect(lines(recordsCsv(ofKind("surge"), "surge", "en"))[3]).toBe(
    "30,Computed from past data,AI infrastructure,2026-05-04,2026-05-20,Fell below trend,Shown,4.25,8.5,-1.75,9.3333333",
  );
  expect(lines(recordsCsv(ofKind("movers"), "movers", "en"))[3]).toBe(
    "2026-03-03,OM1,Old Mover 1,19.125,OM2,Old Mover 2,18.125,OM3,Old Mover 3,17.125,OM4,Old Mover 4,16.125,OM5,Old Mover 5,15.125",
  );
});

test("missing values are empty fields, not 0 or a dash", () => {
  const open = recordsCsv(rows.filter((row) => row.kind === "risk" && row.id === "12"), "risk", "en");
  expect(lines(open)[1]).toBe(
    "12,Live,2026-10-14,,4,3,\"Semiconductors, Philadelphia Semiconductor (SOX), AI infrastructure\",W1 W2 W3 W4,Semiconductors,,,,,Pending",
  );
});

test("rows are newest first across kinds, and the all view names each kind", () => {
  expect(rows.map((row) => `${row.kind}:${row.id}`)).toEqual([
    "movers:2026-10-19", "surge:42", "surge:41", "movers:2026-10-16", "risk:12", "surge:30", "movers:2026-03-03", "risk:9", "risk:5",
  ]);
  expect(lines(recordsCsv(rows.slice(0, 2), "all", "en")).slice(1, 3)).toEqual([
    "Yesterday's gainers,2026-10-19,,2026-10-19,,\"NM1, NM2, NM3, NM4, NM5\"",
    "Surge,42,Live,2026-10-16,,Semiconductors",
  ]);
});

test("the file name carries the kind and the range", () => {
  expect(recordsCsvName("surge", "2026-01-01", "2026-10-20")).toBe("moneyview-signals-surge-2026-01-01_2026-10-20.csv");
});
