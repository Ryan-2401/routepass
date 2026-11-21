"use client";
import type { EntryCheck } from "@/lib/types";
import { Sources } from "./bits";

const LV = { block: "불가", warn: "주의", ok: "가능", info: "안내" } as const;

export default function EntryPanel({ checks, loading }: { checks: EntryCheck[] | null; loading: boolean }) {
  if (loading && !checks) return <p className="muted">출입국 조건을 계산하는 중…</p>;
  if (!checks) return null;
  return (
    <ul className="checks">
      {checks.map((c, i) => (
        <li className="check" key={i} data-lv={c.level}>
          <span className="lv">{LV[c.level]}</span>
          <div>
            <div className="t">{c.title}</div>
            <div className="dt">{c.detail}</div>
            <Sources list={c.sources} />
          </div>
        </li>
      ))}
    </ul>
  );
}
