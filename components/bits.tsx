// 작은 공용 컴포넌트: 상태 도장, AI 표시, 출처 목록, 금액·시간 표기
import type { SourceRef, VerifyStatus } from "@/lib/types";

export const STATUS_KO: Record<VerifyStatus | "pending", string> = {
  operating: "운행 중",
  conditional: "조건부 운행",
  changed: "최근 변경",
  suspended: "운행 중단",
  unknown: "확인 불가",
  pending: "확인 중",
};

export function Stamp({ s }: { s: VerifyStatus | "pending" }) {
  return (
    <span className="stamp" data-s={s}>
      {STATUS_KO[s]}
    </span>
  );
}

export function AiTag({ demo }: { demo?: boolean }) {
  return demo ? (
    <span className="ai-tag demo" title="데모 모드: 개발자가 작성한 예시입니다">예시 데이터</span>
  ) : (
    <span className="ai-tag" title="AI가 생성한 내용입니다. 사실과 다를 수 있습니다">AI가 생성한 내용</span>
  );
}

export function Sources({ list }: { list?: SourceRef[] }) {
  if (!list?.length) return null;
  return (
    <ul className="sources">
      {list.map((s) => (
        <li key={s.url}>
          <a href={s.url} target="_blank" rel="noreferrer">
            {s.title}
          </a>
          {s.date ? <span className="muted"> · {s.date.slice(0, 10)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
export function hm(min?: number) {
  if (!min) return "시간 정보 없음";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}시간${m ? ` ${m}분` : ""}` : `${m}분`;
}
export const MODE_KO: Record<string, string> = { flight: "항공", train: "기차", bus: "버스", ferry: "페리", car: "차량", walk: "도보" };
